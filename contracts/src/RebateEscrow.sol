// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@erc8004/interfaces/IReputationRegistry.sol";

/**
 * @title RebateEscrow ("Pfand")
 * @notice Payment-backed reputation bond for ERC-8004 agents.
 *
 * The service fee is paid out-of-band, gas-free, over x402 / Circle nanopayments —
 * the escrow never touches it. What the escrow holds is the *Pfand*: a refundable
 * deposit, sized at 10% of the fee, that bonds the client's promise to leave honest
 * feedback. The deposit is returned to the client ONLY if they post *fresh*,
 * non-revoked feedback about that agent to the ERC-8004 ReputationRegistry — verified
 * on-chain here in a single staticcall. No feedback before the deadline => the deposit
 * is forfeited to the treasury.
 *
 * This makes feedback economically costly to skip and cryptographically tied to a real
 * payment: an index built on these signals is strictly harder to fake than one scraped
 * from permissionless feedback events.
 *
 * "Fresh" = the client's last feedback index for the agent must be strictly greater than
 * it was when the job opened, so old/recycled feedback can't unlock a new deposit.
 */
contract RebateEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Pfand is 10% of the fee (in basis points).
    uint16 public constant PFAND_BPS = 1000;
    uint16 public constant BPS_DENOM = 10000;

    IERC20 public immutable usdc;
    IReputationRegistry public immutable reputation;
    address public immutable treasury;

    enum Status {
        None,
        Open,
        Settled
    }

    struct Job {
        address client;
        address serviceWallet;
        uint256 agentId;
        uint256 fee; // recorded for context; paid via x402, NOT escrowed
        uint256 pfand; // the deposit actually held by this contract
        uint64 feedbackIndexAtOpen;
        uint64 feedbackDeadline;
        Status status;
    }

    uint256 public nextJobId = 1;
    mapping(uint256 => Job) public jobs;

    event JobOpened(
        uint256 indexed jobId,
        address indexed client,
        uint256 indexed agentId,
        address serviceWallet,
        uint256 fee,
        uint256 pfand,
        uint64 feedbackDeadline
    );
    event RebateClaimed(uint256 indexed jobId, address indexed client, uint256 pfand, uint64 feedbackIndex);
    event RebateForfeited(uint256 indexed jobId, address indexed treasury, uint256 pfand);

    constructor(address _usdc, address _reputation, address _treasury) {
        require(_usdc != address(0) && _reputation != address(0) && _treasury != address(0), "zero addr");
        usdc = IERC20(_usdc);
        reputation = IReputationRegistry(_reputation);
        treasury = _treasury;
    }

    /**
     * @notice Open a job by posting the Pfand bond (10% of `fee`). Caller must approve this
     *         contract for the pfand amount. The `fee` itself is paid out-of-band over x402.
     * @param agentId ERC-8004 agent being hired (the agent the client will post feedback about).
     * @param serviceWallet wallet that performed the work (recorded for context).
     * @param fee the agreed service fee in USDC base units (used only to derive the 10% pfand).
     * @param feedbackWindow seconds the client has to post feedback before the pfand can be forfeited.
     */
    function openJob(uint256 agentId, address serviceWallet, uint256 fee, uint64 feedbackWindow)
        external
        nonReentrant
        returns (uint256 jobId)
    {
        require(serviceWallet != address(0), "zero service");
        require(fee > 0, "zero fee");
        require(feedbackWindow > 0, "zero window");

        uint256 pfand = (fee * PFAND_BPS) / BPS_DENOM;
        require(pfand > 0, "pfand rounds to zero");

        usdc.safeTransferFrom(msg.sender, address(this), pfand);

        // Snapshot the client's current feedback index so only NEW feedback unlocks the pfand.
        uint64 indexAtOpen = reputation.getLastIndex(agentId, msg.sender);
        uint64 deadline = uint64(block.timestamp) + feedbackWindow;

        jobId = nextJobId++;
        jobs[jobId] = Job({
            client: msg.sender,
            serviceWallet: serviceWallet,
            agentId: agentId,
            fee: fee,
            pfand: pfand,
            feedbackIndexAtOpen: indexAtOpen,
            feedbackDeadline: deadline,
            status: Status.Open
        });

        emit JobOpened(jobId, msg.sender, agentId, serviceWallet, fee, pfand, deadline);
    }

    /**
     * @notice Reclaim the Pfand by having posted fresh, non-revoked feedback about the agent.
     */
    function claimRebate(uint256 jobId) external nonReentrant {
        Job storage j = jobs[jobId];
        require(j.status == Status.Open, "not open");
        require(msg.sender == j.client, "only client");

        uint64 lastIndex = _freshFeedbackIndex(j.agentId, j.client, j.feedbackIndexAtOpen);
        require(lastIndex > 0, "no fresh feedback");

        j.status = Status.Settled;
        usdc.safeTransfer(j.client, j.pfand);

        emit RebateClaimed(jobId, j.client, j.pfand, lastIndex);
    }

    /**
     * @notice After the deadline with no fresh feedback, forfeit the Pfand to the treasury.
     */
    function forfeitPfand(uint256 jobId) external nonReentrant {
        Job storage j = jobs[jobId];
        require(j.status == Status.Open, "not open");
        require(block.timestamp > j.feedbackDeadline, "deadline not passed");
        require(_freshFeedbackIndex(j.agentId, j.client, j.feedbackIndexAtOpen) == 0, "client can claim");

        j.status = Status.Settled;
        usdc.safeTransfer(treasury, j.pfand);

        emit RebateForfeited(jobId, treasury, j.pfand);
    }

    /// @notice View helper for UIs/agents: is the pfand currently claimable?
    function isRebateClaimable(uint256 jobId) external view returns (bool) {
        Job storage j = jobs[jobId];
        if (j.status != Status.Open) return false;
        return _freshFeedbackIndex(j.agentId, j.client, j.feedbackIndexAtOpen) > 0;
    }

    /**
     * @dev Returns the client's last feedback index if it is fresh (> snapshot) and not revoked,
     *      otherwise 0. One staticcall to getLastIndex + one to readFeedback.
     */
    function _freshFeedbackIndex(uint256 agentId, address client, uint64 indexAtOpen)
        internal
        view
        returns (uint64)
    {
        uint64 lastIndex = reputation.getLastIndex(agentId, client);
        if (lastIndex <= indexAtOpen) return 0;
        (,,,, bool isRevoked) = reputation.readFeedback(agentId, client, lastIndex);
        if (isRevoked) return 0;
        return lastIndex;
    }
}

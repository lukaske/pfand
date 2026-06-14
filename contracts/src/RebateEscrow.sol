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
 * "Fresh" = the feedback index used to claim must be strictly greater than the client's
 * last index when the job opened, so old/recycled feedback can't unlock a new deposit.
 *
 * Each feedback index can release at most ONE job: the client names the specific index
 * when claiming and the contract marks it consumed. This is what makes the bond honest
 * under concurrency — if the same client opens N jobs for one agent (e.g. a broker acting
 * for many users), they must post N distinct reviews to reclaim all N deposits; a single
 * review can't unlock them all.
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

    /// @dev (client, agentId, feedbackIndex) => already used to claim a Pfand.
    ///      Ensures one review can release at most one job.
    mapping(address => mapping(uint256 => mapping(uint64 => bool))) public consumed;

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
     * @notice Reclaim the Pfand by naming the specific fresh, non-revoked, unused feedback
     *         entry that closes this job. That index is then consumed so it can't release
     *         another job for the same agent.
     * @param jobId the open job.
     * @param feedbackIndex the client's ERC-8004 feedback index for this agent that pays off
     *        this job (must be > the index snapshotted at openJob, not revoked, not yet used).
     */
    function claimRebate(uint256 jobId, uint64 feedbackIndex) external nonReentrant {
        Job storage j = jobs[jobId];
        require(j.status == Status.Open, "not open");
        require(msg.sender == j.client, "only client");
        require(feedbackIndex > j.feedbackIndexAtOpen, "stale feedback");
        require(feedbackIndex <= reputation.getLastIndex(j.agentId, j.client), "no such feedback");
        require(!consumed[j.client][j.agentId][feedbackIndex], "feedback already used");
        (,,,, bool isRevoked) = reputation.readFeedback(j.agentId, j.client, feedbackIndex);
        require(!isRevoked, "feedback revoked");

        consumed[j.client][j.agentId][feedbackIndex] = true;
        j.status = Status.Settled;
        usdc.safeTransfer(j.client, j.pfand);

        emit RebateClaimed(jobId, j.client, j.pfand, feedbackIndex);
    }

    /**
     * @notice After the deadline, forfeit the Pfand to the treasury if the client posted no
     *         new feedback for the agent during the window (a full no-show). If they reviewed
     *         at all, they keep the right to reclaim by naming an unused index — the treasury
     *         can't grab a bond from a client who has been leaving reviews.
     */
    function forfeitPfand(uint256 jobId) external nonReentrant {
        Job storage j = jobs[jobId];
        require(j.status == Status.Open, "not open");
        require(block.timestamp > j.feedbackDeadline, "deadline not passed");
        require(reputation.getLastIndex(j.agentId, j.client) <= j.feedbackIndexAtOpen, "client can claim");

        j.status = Status.Settled;
        usdc.safeTransfer(treasury, j.pfand);

        emit RebateForfeited(jobId, treasury, j.pfand);
    }

    /// @notice View helper: can `feedbackIndex` currently be used to claim `jobId`?
    function isRebateClaimable(uint256 jobId, uint64 feedbackIndex) external view returns (bool) {
        Job storage j = jobs[jobId];
        if (j.status != Status.Open) return false;
        if (feedbackIndex <= j.feedbackIndexAtOpen) return false;
        if (feedbackIndex > reputation.getLastIndex(j.agentId, j.client)) return false;
        if (consumed[j.client][j.agentId][feedbackIndex]) return false;
        (,,,, bool isRevoked) = reputation.readFeedback(j.agentId, j.client, feedbackIndex);
        return !isRevoked;
    }
}

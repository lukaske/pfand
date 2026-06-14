// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "forge-std/Test.sol";
import "../src/RebateEscrow.sol";
import "../src/erc8004/IdentityRegistry.sol";
import "../src/erc8004/ReputationRegistry.sol";
import "./mocks/MockUSDC.sol";

contract RebateEscrowTest is Test {
    MockUSDC usdc;
    IdentityRegistry identity;
    ReputationRegistry reputation;
    RebateEscrow escrow;

    address client = makeAddr("client");
    address serviceAgent = makeAddr("serviceAgent"); // owns the agent NFT
    address treasury = makeAddr("treasury");

    uint256 agentId;
    uint256 constant FEE = 100e6; // 100 USDC (paid via x402, not escrowed)
    uint256 constant PFAND = 10e6; // 10% of fee — the only amount escrowed
    uint64 constant WINDOW = 1 days;

    function setUp() public {
        usdc = new MockUSDC();
        identity = new IdentityRegistry();
        reputation = new ReputationRegistry(address(identity));
        escrow = new RebateEscrow(address(usdc), address(reputation), treasury);

        vm.prank(serviceAgent);
        agentId = identity.register("ipfs://agent-card.json");

        usdc.mint(client, 1_000e6);
        vm.prank(client);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _openJob() internal returns (uint256 jobId) {
        vm.prank(client);
        jobId = escrow.openJob(agentId, serviceAgent, FEE, WINDOW);
    }

    function _giveFeedback(int128 value) internal returns (uint64) {
        vm.prank(client);
        reputation.giveFeedback(agentId, value, 0, "audit", "", "https://broker8004/job", "", bytes32(0));
        return reputation.getLastIndex(agentId, client);
    }

    function test_OpenJob_EscrowsPfandOnly() public {
        uint256 jobId = _openJob();
        // Only the Pfand is escrowed; the fee is paid out-of-band via x402.
        assertEq(usdc.balanceOf(address(escrow)), PFAND);
        assertEq(usdc.balanceOf(client), 1_000e6 - PFAND);

        (address c,, uint256 id, uint256 fee, uint256 pfand,,, RebateEscrow.Status status) = escrow.jobs(jobId);
        assertEq(c, client);
        assertEq(id, agentId);
        assertEq(fee, FEE);
        assertEq(pfand, PFAND);
        assertEq(uint8(status), uint8(RebateEscrow.Status.Open));
    }

    function test_FullPfandLoop_FeedbackUnlocksRebate() public {
        uint256 jobId = _openJob();

        // Cannot claim before any matching feedback exists.
        assertFalse(escrow.isRebateClaimable(jobId, 1));
        vm.prank(client);
        vm.expectRevert("no such feedback");
        escrow.claimRebate(jobId, 1);

        // Post fresh feedback -> pfand becomes claimable at that index.
        uint64 idx = _giveFeedback(95);
        assertTrue(escrow.isRebateClaimable(jobId, idx));

        uint256 balBefore = usdc.balanceOf(client);
        vm.prank(client);
        escrow.claimRebate(jobId, idx);

        assertEq(usdc.balanceOf(client), balBefore + PFAND);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_StaleFeedback_DoesNotUnlockNewJob() public {
        // Client left feedback once before (a prior interaction).
        uint64 oldIdx = _giveFeedback(80);

        // New job snapshots the index; the old feedback must not count.
        uint256 jobId = _openJob();
        assertFalse(escrow.isRebateClaimable(jobId, oldIdx));
        vm.prank(client);
        vm.expectRevert("stale feedback");
        escrow.claimRebate(jobId, oldIdx);

        // Fresh feedback for this job unlocks it.
        uint64 newIdx = _giveFeedback(90);
        vm.prank(client);
        escrow.claimRebate(jobId, newIdx);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_RevokedFeedback_DoesNotUnlock() public {
        uint256 jobId = _openJob();

        uint64 idx = _giveFeedback(90); // index 1
        vm.prank(client);
        reputation.revokeFeedback(agentId, idx);

        assertFalse(escrow.isRebateClaimable(jobId, idx));
        vm.prank(client);
        vm.expectRevert("feedback revoked");
        escrow.claimRebate(jobId, idx);
    }

    function test_ConcurrentJobs_OneReviewReleasesOneJob() public {
        // Same client opens two jobs for the same agent (e.g. a broker for two users).
        uint256 jobA = _openJob();
        uint256 jobB = _openJob();

        // A single review must NOT unlock both deposits.
        uint64 idx1 = _giveFeedback(90);
        vm.prank(client);
        escrow.claimRebate(jobA, idx1);

        vm.prank(client);
        vm.expectRevert("feedback already used");
        escrow.claimRebate(jobB, idx1);

        // A second, distinct review is required to release the second deposit.
        uint64 idx2 = _giveFeedback(85);
        vm.prank(client);
        escrow.claimRebate(jobB, idx2);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_Forfeit_AfterDeadlineNoFeedback() public {
        uint256 jobId = _openJob();

        vm.expectRevert("deadline not passed");
        escrow.forfeitPfand(jobId);

        vm.warp(block.timestamp + WINDOW + 1);
        escrow.forfeitPfand(jobId);
        assertEq(usdc.balanceOf(treasury), PFAND);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_Forfeit_BlockedWhenFeedbackExists() public {
        uint256 jobId = _openJob();
        _giveFeedback(90);

        vm.warp(block.timestamp + WINDOW + 1);
        vm.expectRevert("client can claim");
        escrow.forfeitPfand(jobId);
    }

    function test_OnlyClientCanClaim() public {
        uint256 jobId = _openJob();
        uint64 idx = _giveFeedback(90);
        vm.prank(serviceAgent);
        vm.expectRevert("only client");
        escrow.claimRebate(jobId, idx);
    }

    function test_CannotClaimTwice() public {
        uint256 jobId = _openJob();
        uint64 idx = _giveFeedback(90);
        vm.prank(client);
        escrow.claimRebate(jobId, idx);
        vm.prank(client);
        vm.expectRevert("not open");
        escrow.claimRebate(jobId, idx);
    }
}

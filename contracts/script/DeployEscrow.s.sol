// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "forge-std/Script.sol";
import "../src/RebateEscrow.sol";

/**
 * @notice Redeploys ONLY the RebateEscrow, reusing the already-deployed ERC-8004
 *         ReputationRegistry (so existing agents/reviews are untouched). Used to ship
 *         the per-index `claimRebate(jobId, feedbackIndex)` upgrade.
 *
 * Env:
 *   PRIVATE_KEY         deployer key (also treasury unless TREASURY set)
 *   USDC_ADDRESS        Arc Testnet USDC (0x3600000000000000000000000000000000000000)
 *   REPUTATION_ADDRESS  existing ReputationRegistry
 *   TREASURY            optional; defaults to deployer
 *
 * Run:
 *   forge script script/DeployEscrow.s.sol --rpc-url arc_testnet --broadcast
 */
contract DeployEscrow is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address reputation = vm.envAddress("REPUTATION_ADDRESS");
        address treasury = vm.envOr("TREASURY", vm.addr(pk));

        vm.startBroadcast(pk);
        RebateEscrow escrow = new RebateEscrow(usdc, reputation, treasury);
        vm.stopBroadcast();

        console2.log("RebateEscrow", address(escrow));
        console2.log("Reputation  ", reputation);
        console2.log("USDC        ", usdc);
        console2.log("Treasury    ", treasury);
    }
}

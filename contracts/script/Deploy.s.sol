// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "forge-std/Script.sol";
import "../src/erc8004/IdentityRegistry.sol";
import "../src/erc8004/ReputationRegistry.sol";
import "../src/erc8004/ValidationRegistry.sol";
import "../src/RebateEscrow.sol";

/**
 * @notice Deploys the Pfand stack to Arc Testnet (or any EVM chain).
 *
 * Env:
 *   PRIVATE_KEY   deployer key (also used as treasury unless TREASURY set)
 *   USDC_ADDRESS  ERC-20 used by the escrow (Arc Testnet: 0x3600000000000000000000000000000000000000)
 *   TREASURY      optional; defaults to deployer
 *
 * Run:
 *   forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
 */
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address treasury = vm.envOr("TREASURY", vm.addr(pk));

        vm.startBroadcast(pk);

        IdentityRegistry identity = new IdentityRegistry();
        ReputationRegistry reputation = new ReputationRegistry(address(identity));
        ValidationRegistry validation = new ValidationRegistry(address(identity));
        RebateEscrow escrow = new RebateEscrow(usdc, address(reputation), treasury);

        vm.stopBroadcast();

        console2.log("IdentityRegistry  ", address(identity));
        console2.log("ReputationRegistry", address(reputation));
        console2.log("ValidationRegistry", address(validation));
        console2.log("RebateEscrow      ", address(escrow));
        console2.log("USDC              ", usdc);
        console2.log("Treasury          ", treasury);
    }
}

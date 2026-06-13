// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "forge-std/Script.sol";
import "../src/ens/OffchainResolver.sol";

/**
 * @notice Deploys the Pfand ENS OffchainResolver (CCIP-Read) to Sepolia (or any chain).
 *
 * Env:
 *   PRIVATE_KEY     deployer key
 *   GATEWAY_URL     the CCIP-Read gateway endpoint, e.g. https://gw.pfand.xyz/{sender}/{data}.json
 *   SIGNER_ADDRESS  the address whose key the gateway signs responses with (ENS_GATEWAY_SIGNER_KEY)
 *
 * Run:
 *   forge script script/DeployResolver.s.sol --rpc-url sepolia --broadcast
 *
 * After deploy: set this contract as the resolver of agent8004.eth (the parent name) on Sepolia.
 */
contract DeployResolver is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        string memory gatewayUrl = vm.envString("GATEWAY_URL");
        address signer = vm.envAddress("SIGNER_ADDRESS");

        address[] memory signers = new address[](1);
        signers[0] = signer;

        vm.startBroadcast(pk);
        OffchainResolver resolver = new OffchainResolver(gatewayUrl, signers);
        vm.stopBroadcast();

        console2.log("OffchainResolver ", address(resolver));
        console2.log("Gateway URL      ", gatewayUrl);
        console2.log("Authorized signer", signer);
    }
}

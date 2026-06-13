// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/// @notice ENSIP-10 wildcard resolution interface. Interface id 0x9061b923.
/// Forked from ensdomains/offchain-resolver (made 0.8.19-compatible).
interface IExtendedResolver {
    function resolve(bytes memory name, bytes memory data) external view returns (bytes memory);
}

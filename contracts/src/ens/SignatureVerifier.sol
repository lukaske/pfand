// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @notice Verifies CCIP-Read gateway responses for the OffchainResolver.
 *
 * Forked from ensdomains/offchain-resolver and pinned to solc 0.8.19 + OZ v4.9.6.
 * This is NOT EIP-712; it is a `\x19\x00` (EIP-191 version 0x00, "intended validator")
 * prefixed keccak hash, ECDSA-recovered. The gateway MUST sign the identical bytes.
 */
library SignatureVerifier {
    /**
     * @dev Generates a hash for signing/verifying.
     * @param target  The address the signature is for (the resolver contract).
     * @param expires Unix timestamp after which the signature is no longer valid.
     * @param request The original request that was sent (the inner abi-encoded resolve(name,data) calldata).
     * @param result  The `result` field of the response (the abi-encoded record value).
     */
    function makeSignatureHash(address target, uint64 expires, bytes memory request, bytes memory result)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(hex"1900", target, expires, keccak256(request), keccak256(result)));
    }

    /**
     * @dev Verifies a signed message returned from a callback.
     * @param request  The original CCIP extraData: abi.encode(innerCallData, resolverAddress).
     * @param response An abi-encoded tuple `(bytes result, uint64 expires, bytes sig)`.
     * @return signer The address that signed this message.
     * @return result The `result` decoded from `response`.
     */
    function verify(bytes calldata request, bytes calldata response)
        internal
        view
        returns (address, bytes memory)
    {
        (bytes memory result, uint64 expires, bytes memory sig) = abi.decode(response, (bytes, uint64, bytes));
        (bytes memory extraData, address sender) = abi.decode(request, (bytes, address));
        address signer = ECDSA.recover(makeSignatureHash(sender, expires, extraData, result), sig);
        require(expires >= block.timestamp, "SignatureVerifier: Signature expired");
        return (signer, result);
    }
}

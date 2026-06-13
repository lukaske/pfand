// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./IExtendedResolver.sol";
import "./SignatureVerifier.sol";

/// @dev The function the gateway implements offchain; its selector is what the
/// resolver asks the CCIP client to call against the gateway URL.
interface IResolverService {
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory result, uint64 expires, bytes memory sig);
}

/// @dev Minimal ERC-165 base, replacing @ensdomains/ens-contracts' SupportsInterface
/// (not vendored in this repo). Behaviour is identical for our interface ids.
abstract contract SupportsInterface {
    function supportsInterface(bytes4 interfaceID) public pure virtual returns (bool) {
        return interfaceID == 0x01ffc9a7; // ERC-165
    }
}

/**
 * @title OffchainResolver
 * @notice An ENS resolver that directs all queries to a CCIP-Read gateway (EIP-3668 + ENSIP-10).
 *         Lets `<agent>.broker8004.eth` resolve to live ENSIP-25/26 records served from our index
 *         with no on-chain transaction per subname.
 *
 * Forked from ensdomains/offchain-resolver, pinned to solc 0.8.19 / OZ v4.9.6.
 */
contract OffchainResolver is IExtendedResolver, SupportsInterface {
    string public url;
    mapping(address => bool) public signers;

    event NewSigners(address[] signers);

    error OffchainLookup(
        address sender,
        string[] urls,
        bytes callData,
        bytes4 callbackFunction,
        bytes extraData
    );

    constructor(string memory _url, address[] memory _signers) {
        url = _url;
        for (uint256 i = 0; i < _signers.length; i++) {
            signers[_signers[i]] = true;
        }
        emit NewSigners(_signers);
    }

    function makeSignatureHash(address target, uint64 expires, bytes memory request, bytes memory result)
        external
        pure
        returns (bytes32)
    {
        return SignatureVerifier.makeSignatureHash(target, expires, request, result);
    }

    /**
     * @notice Resolves a name, as specified by ENSIP-10. Always reverts with OffchainLookup.
     * @param name The DNS-encoded name to resolve.
     * @param data The ABI-encoded inner resolution call (addr(bytes32), text(bytes32,string), ...).
     */
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        override
        returns (bytes memory)
    {
        bytes memory callData = abi.encodeWithSelector(IResolverService.resolve.selector, name, data);
        string[] memory urls = new string[](1);
        urls[0] = url;
        revert OffchainLookup(
            address(this),
            urls,
            callData,
            OffchainResolver.resolveWithProof.selector,
            abi.encode(callData, address(this))
        );
    }

    /// @notice CCIP-Read callback: verifies the gateway signature and returns the record.
    function resolveWithProof(bytes calldata response, bytes calldata extraData)
        external
        view
        returns (bytes memory)
    {
        (address signer, bytes memory result) = SignatureVerifier.verify(extraData, response);
        require(signers[signer], "SignatureVerifier: Invalid sigature");
        return result;
    }

    function supportsInterface(bytes4 interfaceID) public pure override returns (bool) {
        return interfaceID == type(IExtendedResolver).interfaceId || super.supportsInterface(interfaceID);
    }
}

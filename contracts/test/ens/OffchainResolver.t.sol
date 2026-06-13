// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "forge-std/Test.sol";
import "../../src/ens/OffchainResolver.sol";

contract OffchainResolverTest is Test {
    OffchainResolver internal resolver;

    string internal constant GATEWAY_URL = "https://gw.pfand.xyz/{sender}/{data}.json";

    uint256 internal signerPk;
    address internal signer;

    uint256 internal badPk;
    address internal badSigner;

    // DNS-encoded "alice.agent8004.eth": 5 alice 11 broker8004 3 eth 0
    bytes internal dnsName =
        hex"05616c69636500"; // placeholder, overwritten in setUp via _dnsEncode

    function setUp() public {
        (signer, signerPk) = makeAddrAndKey("gatewaySigner");
        (badSigner, badPk) = makeAddrAndKey("attacker");

        address[] memory signers = new address[](1);
        signers[0] = signer;
        resolver = new OffchainResolver(GATEWAY_URL, signers);

        dnsName = _dnsEncode("alice.agent8004.eth");
    }

    function test_SupportsExtendedResolverInterface() public {
        assertTrue(resolver.supportsInterface(type(IExtendedResolver).interfaceId));
        assertEq(type(IExtendedResolver).interfaceId, bytes4(0x9061b923));
        assertTrue(resolver.supportsInterface(0x01ffc9a7)); // ERC-165
    }

    /// resolve() must always revert with OffchainLookup carrying the gateway URL + callData.
    function test_ResolveRevertsWithOffchainLookup() public {
        // text(node, "agent-context")
        bytes32 node = keccak256("alice.agent8004.eth.node");
        bytes memory innerData =
            abi.encodeWithSelector(bytes4(keccak256("text(bytes32,string)")), node, "agent-context");

        bytes memory expectedCallData =
            abi.encodeWithSelector(IResolverService.resolve.selector, dnsName, innerData);

        vm.expectRevert(
            abi.encodeWithSelector(
                OffchainResolver.OffchainLookup.selector,
                address(resolver),
                _singleUrl(GATEWAY_URL),
                expectedCallData,
                OffchainResolver.resolveWithProof.selector,
                abi.encode(expectedCallData, address(resolver))
            )
        );
        resolver.resolve(dnsName, innerData);
    }

    /// resolveWithProof() returns the record for a correctly-signed response.
    function test_ResolveWithProof_ValidSigner() public {
        bytes32 node = keccak256("alice.agent8004.eth.node");
        bytes memory innerData =
            abi.encodeWithSelector(bytes4(keccak256("text(bytes32,string)")), node, "agent-context");

        // This mirrors exactly what resolve() puts in extraData.
        bytes memory innerCallData =
            abi.encodeWithSelector(IResolverService.resolve.selector, dnsName, innerData);
        bytes memory extraData = abi.encode(innerCallData, address(resolver));

        // The record the gateway would return: abi.encode(string).
        bytes memory result = abi.encode("Pfand demo trading agent. mcp at https://alice.pfand.xyz/mcp");
        uint64 expires = uint64(block.timestamp + 1 hours);

        bytes memory response = _sign(signerPk, innerCallData, result, expires);

        bytes memory got = resolver.resolveWithProof(response, extraData);
        assertEq(keccak256(got), keccak256(result));
        assertEq(abi.decode(got, (string)), "Pfand demo trading agent. mcp at https://alice.pfand.xyz/mcp");
    }

    /// resolveWithProof() reverts when signed by an unregistered signer.
    function test_ResolveWithProof_BadSigner_Reverts() public {
        bytes32 node = keccak256("alice.agent8004.eth.node");
        bytes memory innerData =
            abi.encodeWithSelector(bytes4(keccak256("addr(bytes32)")), node);
        bytes memory innerCallData =
            abi.encodeWithSelector(IResolverService.resolve.selector, dnsName, innerData);
        bytes memory extraData = abi.encode(innerCallData, address(resolver));

        bytes memory result = abi.encode(address(0xCAFE));
        uint64 expires = uint64(block.timestamp + 1 hours);

        bytes memory response = _sign(badPk, innerCallData, result, expires);

        vm.expectRevert("SignatureVerifier: Invalid sigature");
        resolver.resolveWithProof(response, extraData);
    }

    /// An expired (but correctly-signed) response is rejected.
    function test_ResolveWithProof_Expired_Reverts() public {
        bytes memory innerData =
            abi.encodeWithSelector(bytes4(keccak256("addr(bytes32)")), bytes32(uint256(1)));
        bytes memory innerCallData =
            abi.encodeWithSelector(IResolverService.resolve.selector, dnsName, innerData);
        bytes memory extraData = abi.encode(innerCallData, address(resolver));

        bytes memory result = abi.encode(address(0xCAFE));
        // Move time forward so `expires` is in the past.
        vm.warp(1_000_000);
        uint64 expires = uint64(block.timestamp - 1);

        bytes memory response = _sign(signerPk, innerCallData, result, expires);

        vm.expectRevert("SignatureVerifier: Signature expired");
        resolver.resolveWithProof(response, extraData);
    }

    // --- helpers ---

    /// Reproduces makeSignatureHash + ECDSA signing exactly as the gateway must.
    function _sign(uint256 pk, bytes memory request, bytes memory result, uint64 expires)
        internal
        view
        returns (bytes memory response)
    {
        bytes32 hash = keccak256(
            abi.encodePacked(
                hex"1900", address(resolver), expires, keccak256(request), keccak256(result)
            )
        );
        // Sanity-check against the contract's own pure helper.
        assertEq(hash, resolver.makeSignatureHash(address(resolver), expires, request, result));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, hash);
        bytes memory sig = abi.encodePacked(r, s, v);
        response = abi.encode(result, expires, sig);
    }

    function _singleUrl(string memory u) internal pure returns (string[] memory urls) {
        urls = new string[](1);
        urls[0] = u;
    }

    /// Minimal DNS wire-format encoder for tests (label-length prefixes, null terminator).
    function _dnsEncode(string memory name) internal pure returns (bytes memory) {
        bytes memory n = bytes(name);
        bytes memory out = new bytes(n.length + 2);
        uint256 outIdx;
        uint256 labelStart;
        for (uint256 i = 0; i <= n.length; i++) {
            if (i == n.length || n[i] == ".") {
                uint256 len = i - labelStart;
                out[outIdx++] = bytes1(uint8(len));
                for (uint256 j = labelStart; j < i; j++) {
                    out[outIdx++] = n[j];
                }
                labelStart = i + 1;
            }
        }
        out[outIdx++] = 0x00;
        // Trim to actual length.
        bytes memory trimmed = new bytes(outIdx);
        for (uint256 k = 0; k < outIdx; k++) {
            trimmed[k] = out[k];
        }
        return trimmed;
    }
}

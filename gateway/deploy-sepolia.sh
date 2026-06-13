#!/usr/bin/env bash
#
# Deploy (and optionally Etherscan-verify) the Pfand OffchainResolver to Sepolia,
# then print the exact follow-up steps to point a parent ENS name at it.
#
# This wraps `forge script DeployResolver.s.sol` with the env-var mapping the
# repo's .env uses (ENS_* names) and a balance pre-flight so it never spins
# forever on an unfunded key.
#
# Usage:
#   ./gateway/deploy-sepolia.sh            # deploy
#   VERIFY=1 ./gateway/deploy-sepolia.sh   # deploy + etherscan verify (needs ETHERSCAN_API_KEY)
#
# Reads from the repo-root .env:
#   SEPOLIA_RPC_URL
#   SEPOLIA_PRIVATE_KEY        (deployer; == ENS_GATEWAY_SIGNER_KEY in this repo)
#   ENS_SIGNER_ADDRESS         (authorized gateway signer registered on the resolver)
#   ENS_GATEWAY_URL            (CCIP-Read endpoint template; falls back to gw.pfand.xyz)
#   ETHERSCAN_API_KEY          (only needed for VERIFY=1)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found"; exit 1; }

# Load only the keys we need (avoids sourcing arbitrary shell).
get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//'; }

SEPOLIA_RPC_URL="$(get SEPOLIA_RPC_URL)"
PRIVATE_KEY="$(get SEPOLIA_PRIVATE_KEY)"
SIGNER_ADDRESS="$(get ENS_SIGNER_ADDRESS)"
GATEWAY_URL="$(get ENS_GATEWAY_URL)"
ETHERSCAN_API_KEY="$(get ETHERSCAN_API_KEY)"

# The OffchainResolver `url` is immutable, so it MUST be the real gateway endpoint.
[ -n "$GATEWAY_URL" ] || GATEWAY_URL='https://gw.pfand.xyz/{sender}/{data}.json'

[ -n "$SEPOLIA_RPC_URL" ] || { echo "ERROR: SEPOLIA_RPC_URL missing"; exit 1; }
[ -n "$PRIVATE_KEY" ]     || { echo "ERROR: SEPOLIA_PRIVATE_KEY missing"; exit 1; }
[ -n "$SIGNER_ADDRESS" ]  || { echo "ERROR: ENS_SIGNER_ADDRESS missing"; exit 1; }

echo "=== Pfand OffchainResolver -> Sepolia ==="
echo "deployer/signer : $SIGNER_ADDRESS"
echo "gateway url     : $GATEWAY_URL"
echo "rpc             : $SEPOLIA_RPC_URL"

# ---- balance pre-flight: do not attempt a deploy we can't pay for ----
BAL_WEI="$(cast balance "$SIGNER_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL")"
BAL_ETH="$(cast from-wei "$BAL_WEI")"
echo "balance         : $BAL_ETH ETH ($BAL_WEI wei)"
# need ~0.002 ETH headroom; 2000000000000000 wei
if [ "$(printf '%s\n' "$BAL_WEI" "2000000000000000" | sort -g | head -1)" = "$BAL_WEI" ] \
   && [ "$BAL_WEI" != "2000000000000000" ]; then
  echo
  echo "STOP: deployer has < 0.002 Sepolia ETH. Fund $SIGNER_ADDRESS first:"
  echo "  - https://sepoliafaucet.com  /  https://www.alchemy.com/faucets/ethereum-sepolia"
  echo "Then re-run this script. (No transaction was sent.)"
  exit 2
fi

cd "$ROOT/contracts"

VERIFY_ARGS=()
if [ "${VERIFY:-0}" = "1" ]; then
  [ -n "$ETHERSCAN_API_KEY" ] || { echo "ERROR: VERIFY=1 but ETHERSCAN_API_KEY missing"; exit 1; }
  VERIFY_ARGS=(--verify --etherscan-api-key "$ETHERSCAN_API_KEY")
fi

PRIVATE_KEY="$PRIVATE_KEY" \
GATEWAY_URL="$GATEWAY_URL" \
SIGNER_ADDRESS="$SIGNER_ADDRESS" \
SEPOLIA_RPC_URL="$SEPOLIA_RPC_URL" \
forge script script/DeployResolver.s.sol:DeployResolver \
  --rpc-url "$SEPOLIA_RPC_URL" --broadcast "${VERIFY_ARGS[@]}"

# Pull the deployed address out of the broadcast log for convenience.
BCAST="$ROOT/contracts/broadcast/DeployResolver.s.sol/11155111/run-latest.json"
if [ -f "$BCAST" ]; then
  ADDR="$(grep -o '"contractAddress":"0x[0-9a-fA-F]\{40\}"' "$BCAST" | head -1 | grep -o '0x[0-9a-fA-F]\{40\}')"
  echo
  echo "=== DEPLOYED ==="
  echo "OffchainResolver : $ADDR"
  echo
  echo "Next (go-live):"
  echo "  1. Put this in .env:   ENS_OFFCHAIN_RESOLVER=$ADDR"
  echo "  2. Own a parent name on Sepolia (e.g. broker8004.eth) — see gateway/deploy-sepolia.md."
  echo "  3. Set that name's resolver to $ADDR (ENS app -> Records -> Edit Resolver,"
  echo "     or: cast send <ENS_REGISTRY> 'setResolver(bytes32,address)' <namehash> $ADDR)."
  echo "  4. Host the gateway at $GATEWAY_URL and confirm GET .../health returns the signer."
  echo "  5. Resolve a subname:  cd gateway && npm run verify   (CCIP-read via UniversalResolver)."
fi

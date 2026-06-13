/**
 * Register `agent8004.eth` on Sepolia and point it at our deployed OffchainResolver.
 *
 * --- Which controller? ---
 * The address given in the brief (0xFED6a969…, the classic wrapped ETHRegistrarController)
 * is verified on Sepolia BUT its NameWrapper (0x0635…) is NOT a `controller` on the
 * BaseRegistrar (0x57f1…), so `registerAndWrapETH2LD` -> `BaseRegistrar.register`
 * reverts on the `onlyController` modifier (confirmed via cast --trace; bare 0x revert).
 *
 * The ACTUAL working `.eth` registration path on Sepolia today is the ENSv2-migration
 * controller `TestnetV1PremigrationRegistrar` at 0xdf60C561Ca35AD3C89D24BbA854654b1c3477078
 * (it IS an authorised controller on the BaseRegistrar; recent live registrations confirm).
 * It is a FREE, single-transaction registration:
 *
 *   register(Registration{label, owner, duration, secret, resolver, data[], reverseRecord, referrer})
 *
 * where Registration is the modern struct (reverseRecord is a uint8 bitmask, referrer is bytes32).
 * When `resolver != 0` it does:
 *   BASE.register(tokenId, address(this), duration)
 *   ENS_REGISTRY.setRecord(namehash, owner, resolver, 0)   <-- sets OUR resolver in the v1 registry
 *   BASE.transferFrom(this, owner, tokenId)
 * i.e. the name is owned DIRECTLY by our wallet in the registry (no NameWrapper) with the
 * resolver already pointed at our OffchainResolver. No commit/reveal, no fee.
 *
 * After this runs: Registry.resolver(namehash(agent8004.eth)) == OFFCHAIN_RESOLVER,
 * Registry.owner(...) == our wallet.
 *
 * Idempotent-ish: if the name is already registered to us, skip to verify; if the
 * resolver isn't ours, fix it via Registry.setResolver.
 *
 * Run: npx tsx src/register-sepolia.ts
 */

import { config } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { namehash, normalize } from "viem/ens";
import { sepolia } from "viem/chains";

config();

// --- constants (Sepolia) ---

const NAME = "agent8004"; // label, no .eth
const FULL_NAME = `${NAME}.eth`;
const DURATION = 31536000n; // 365 days (>= 28-day minimum)
const REVERSE_RECORD = 0; // uint8 bitmask: 0 = no reverse record
const REFERRER =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;
const EMPTY_DATA: readonly Hex[] = []; // no records set during register

// A random-but-FIXED secret (unused by this controller but part of the struct).
const SECRET =
  "0x5066616e6447617465776179416765383030344575c0ffeedeadbeef00000001" as Hex;

const OFFCHAIN_RESOLVER = getAddress(
  "0x03F8C6EF49Ca2945a653F5B62F47EB65A8A2D147",
);
// TestnetV1PremigrationRegistrar — the live, authorised .eth controller on Sepolia.
const CONTROLLER = getAddress("0xdf60C561Ca35AD3C89D24BbA854654b1c3477078");
const REGISTRY = getAddress("0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e");
const BASE_REGISTRAR = getAddress("0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85");

// --- ABIs ---

// IETHRegistrarController.Registration struct (modern ENSv2-era controller).
const registrationComponents = [
  { name: "label", type: "string" },
  { name: "owner", type: "address" },
  { name: "duration", type: "uint256" },
  { name: "secret", type: "bytes32" },
  { name: "resolver", type: "address" },
  { name: "data", type: "bytes[]" },
  { name: "reverseRecord", type: "uint8" },
  { name: "referrer", type: "bytes32" },
] as const;

const controllerAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "payable",
    inputs: [
      { name: "registration", type: "tuple", components: registrationComponents },
    ],
    outputs: [],
  },
] as const;

const baseRegistrarAbi = [
  {
    type: "function",
    name: "available",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const registryAbi = [
  {
    type: "function",
    name: "resolver",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "setResolver",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "resolver", type: "address" },
    ],
    outputs: [],
  },
] as const;

// --- helpers ---

function loadKey(): Hex {
  const k = process.env.SEPOLIA_PRIVATE_KEY ?? process.env.ENS_GATEWAY_SIGNER_KEY;
  if (!k) throw new Error("Missing SEPOLIA_PRIVATE_KEY / ENS_GATEWAY_SIGNER_KEY");
  return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error("Missing SEPOLIA_RPC_URL");

  const { keccak256, toBytes } = await import("viem");
  const account = privateKeyToAccount(loadKey());
  const owner = account.address;
  const node = namehash(normalize(FULL_NAME));
  const tokenId = BigInt(keccak256(toBytes(NAME))); // labelhash of "agent8004"

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  console.log(`Registering ${FULL_NAME}`);
  console.log(`  owner (our wallet) : ${owner}`);
  console.log(`  namehash           : ${node}`);
  console.log(`  target resolver    : ${OFFCHAIN_RESOLVER}`);
  console.log(`  controller         : ${CONTROLLER}`);
  console.log("");

  // --- state read ---
  const [currentResolver, registryOwner, available] = await Promise.all([
    publicClient.readContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: "resolver",
      args: [node],
    }) as Promise<Address>,
    publicClient.readContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: "owner",
      args: [node],
    }) as Promise<Address>,
    publicClient.readContract({
      address: BASE_REGISTRAR,
      abi: baseRegistrarAbi,
      functionName: "available",
      args: [tokenId],
    }) as Promise<boolean>,
  ]);

  console.log(`  available()        : ${available}`);
  console.log(`  registry owner     : ${registryOwner}`);
  console.log(`  registry resolver  : ${currentResolver}`);
  console.log("");

  const txHashes: Record<string, Hex> = {};

  if (!available) {
    // Already registered. Is it ours?
    if (registryOwner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error(
        `${FULL_NAME} is already registered and NOT owned by ${owner} ` +
          `(registry owner=${registryOwner}). Cannot proceed.`,
      );
    }
    console.log(`${FULL_NAME} already registered to us — skipping register.`);

    if (currentResolver.toLowerCase() !== OFFCHAIN_RESOLVER.toLowerCase()) {
      console.log(`Resolver mismatch — fixing via Registry.setResolver...`);
      const hash = await walletClient.writeContract({
        address: REGISTRY,
        abi: registryAbi,
        functionName: "setResolver",
        args: [node, OFFCHAIN_RESOLVER],
      });
      console.log(`  setResolver tx     : ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
      txHashes.setResolver = hash;
    } else {
      console.log(`Resolver already == ${OFFCHAIN_RESOLVER}. Nothing to do.`);
    }
  } else {
    // --- single-tx free registration with resolver set inline ---
    const registration = {
      label: NAME,
      owner,
      duration: DURATION,
      secret: SECRET,
      resolver: OFFCHAIN_RESOLVER,
      data: EMPTY_DATA,
      reverseRecord: REVERSE_RECORD,
      referrer: REFERRER,
    } as const;

    const hash = await walletClient.writeContract({
      address: CONTROLLER,
      abi: controllerAbi,
      functionName: "register",
      args: [registration],
      value: 0n, // free testnet controller
    });
    console.log(`  register tx        : ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  register status    : ${receipt.status}`);
    txHashes.register = hash;
    // tiny settle delay so the next reads see the new state.
    await sleep(2000);
  }

  // --- confirm resolver on-chain ---
  const finalResolver = (await publicClient.readContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: "resolver",
    args: [node],
  })) as Address;
  const finalOwner = (await publicClient.readContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: "owner",
    args: [node],
  })) as Address;
  console.log("");
  console.log(`FINAL Registry.owner(${FULL_NAME})    = ${finalOwner}`);
  console.log(`FINAL Registry.resolver(${FULL_NAME}) = ${finalResolver}`);

  if (finalResolver.toLowerCase() !== OFFCHAIN_RESOLVER.toLowerCase()) {
    console.log(`Resolver not ours — applying follow-up setResolver...`);
    const hash = await walletClient.writeContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: "setResolver",
      args: [node, OFFCHAIN_RESOLVER],
    });
    console.log(`  follow-up setResolver tx : ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
    txHashes.setResolverFollowup = hash;
    const rechecked = (await publicClient.readContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: "resolver",
      args: [node],
    })) as Address;
    console.log(`  re-checked resolver: ${rechecked}`);
  }

  console.log("");
  console.log("=== TX HASHES ===");
  for (const [k, v] of Object.entries(txHashes)) console.log(`  ${k}: ${v}`);
  console.log("");

  const ok =
    (
      (await publicClient.readContract({
        address: REGISTRY,
        abi: registryAbi,
        functionName: "resolver",
        args: [node],
      })) as Address
    ).toLowerCase() === OFFCHAIN_RESOLVER.toLowerCase();
  console.log(
    ok
      ? `DONE: ${FULL_NAME} now uses resolver ${OFFCHAIN_RESOLVER} on Sepolia.`
      : `WARNING: resolver not confirmed; inspect above.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

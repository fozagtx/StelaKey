import nodeCrypto from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import * as secp from "@noble/secp256k1";
import { UltraHonkBackend } from "@aztec/bb.js";
import {
  bitcoinSignedMessageHash,
  bitcoinSignedMessageHashHex,
  bytesToHex,
  canonicalZkAuthorizationMessage,
  hexToBytes,
  ownerCommitmentHex,
  secp256k1PublicKeyParts
} from "@/lib/prover-crypto";

const execFileAsync = promisify(execFile);

type StoredChallenge = {
  btcAddress: string;
  btcPubKey?: string;
  walletProvider: "xverse" | "leather" | "unisat" | "generic";
  purpose: "deploy" | "transfer";
  stellarNetwork: "testnet" | "mainnet";
  message: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  expiryLedger: number;
  domain: "StelaKey";
  replayKey: string;
  messageHash: string;
  stellarIntentHash: string;
  signaturePayloadHash: string;
  networkHash: string;
};

type ChallengeInput = {
  btcAddress?: unknown;
  btcPubKey?: unknown;
  walletProvider?: unknown;
  purpose?: unknown;
  stellarNetwork?: unknown;
  stellarIntentHash?: unknown;
  signaturePayloadHash?: unknown;
  networkHash?: unknown;
  expiryLedger?: unknown;
};

type ProofInput = {
  challengeId?: unknown;
  btcAddress?: unknown;
  btcPubKey?: unknown;
  signature?: unknown;
  signatureScheme?: unknown;
};

export class ProverError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
    message: string
  ) {
    super(message);
  }
}

const appDir = process.cwd();
const circuitDir = resolve(appDir, "prover-circuit");
const nargoBin = process.env.NARGO_BIN ?? resolve(appDir, ".prover-bin/nargo");

function proverSecret() {
  return process.env.PROVER_HMAC_SECRET ?? "stelakey-local-development-prover-secret";
}

function stringField(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProverError(400, "INVALID_CHALLENGE_REQUEST", `${label} is required.`);
  }
  return value;
}

function enumField<T extends string>(value: unknown, label: string, allowed: readonly T[]) {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ProverError(400, "INVALID_CHALLENGE_REQUEST", `${label} is invalid.`);
  }
  return value as T;
}

function hex32(value: unknown, label: string) {
  const text = stringField(value, label);
  const clean = text.startsWith("0x") ? text.slice(2) : text;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new ProverError(400, "INVALID_AUTH_PAYLOAD_HASH", `${label} must be a 32-byte hex string.`);
  }
  return `0x${clean.toLowerCase()}`;
}

function positiveInteger(value: unknown, label: string) {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new ProverError(400, "AUTH_EXPIRY_REQUIRED", `${label} must be a positive integer.`);
  }
  return value as number;
}

function base64Url(bytes: Buffer) {
  return bytes.toString("base64url");
}

function unbase64Url(text: string) {
  return Buffer.from(text, "base64url");
}

function signChallenge(payload: StoredChallenge) {
  const body = base64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  const mac = nodeCrypto.createHmac("sha256", proverSecret()).update(body).digest();
  return `${body}.${base64Url(mac)}`;
}

function readChallenge(challengeId: string): StoredChallenge {
  const [body, mac] = challengeId.split(".");
  if (!body || !mac) {
    throw new ProverError(404, "PROOF_EXPIRED", "Challenge was not recognized.");
  }
  const expected = nodeCrypto.createHmac("sha256", proverSecret()).update(body).digest();
  const actual = unbase64Url(mac);
  if (expected.length !== actual.length || !nodeCrypto.timingSafeEqual(expected, actual)) {
    throw new ProverError(403, "BTC_WALLET_MISMATCH", "Challenge signature is invalid.");
  }

  const parsed = JSON.parse(unbase64Url(body).toString("utf8")) as StoredChallenge;
  if (Date.now() > Date.parse(parsed.expiresAt)) {
    throw new ProverError(410, "PROOF_EXPIRED", "Challenge expired.");
  }
  return parsed;
}

function decodeSignature(value: string) {
  const trimmed = value.trim();
  if (/^(0x)?[0-9a-fA-F]+$/.test(trimmed)) {
    const clean = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
    if (clean.length % 2 === 0) return hexToBytes(clean);
  }
  return new Uint8Array(Buffer.from(trimmed, "base64"));
}

function compactSignatureBytes(value: string) {
  const raw = decodeSignature(value);
  if (raw.length === 64) return raw;

  if (raw.length === 65) {
    const first = raw[0];
    const last = raw[64];
    if (first !== undefined && first >= 27 && first <= 42) return raw.slice(1);
    if (last !== undefined && (last <= 3 || (last >= 27 && last <= 42))) return raw.slice(0, 64);
  }

  throw new ProverError(422, "INVALID_SIGNATURE", "Only compact or recoverable ECDSA signatures are supported.");
}

function bytes32FromHex(value: string, label: string) {
  return hexToBytes(hex32(value, label));
}

function tomlByteArray(bytes: Uint8Array) {
  return `[${Array.from(bytes).join(", ")}]`;
}

function randomFieldHex() {
  return bytesToHex(nodeCrypto.randomBytes(16));
}

function fieldDecimalFromHex(hex: string) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return BigInt(`0x${clean}`).toString(10);
}

function commandFailureDetail(error: unknown) {
  const parts: string[] = [];
  if (error instanceof Error && error.message) {
    parts.push(error.message);
  }
  if (error && typeof error === "object") {
    const execError = error as {
      code?: unknown;
      signal?: unknown;
      stdout?: unknown;
      stderr?: unknown;
    };
    if (execError.code !== undefined) parts.push(`exit=${String(execError.code)}`);
    if (execError.signal !== undefined) parts.push(`signal=${String(execError.signal)}`);
    if (typeof execError.stderr === "string" && execError.stderr.trim()) {
      parts.push(`stderr:\n${execError.stderr.trim()}`);
    }
    if (typeof execError.stdout === "string" && execError.stdout.trim()) {
      parts.push(`stdout:\n${execError.stdout.trim()}`);
    }
  }
  return parts.length > 0 ? parts.join("\n") : "command failed";
}

async function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  try {
    await execFileAsync(command, args, {
      cwd,
      env,
      maxBuffer: 1024 * 1024 * 20
    });
  } catch (error) {
    console.error("prover_command_failed", {
      command,
      args,
      detail: commandFailureDetail(error)
    });
    throw new ProverError(
      500,
      "PROOF_GENERATION_FAILED",
      "Authorization could not be completed because the proof service could not generate a valid proof. No transaction was submitted."
    );
  }
}

async function writableNargoEnv(workDir: string) {
  const homeDir = resolve(workDir, ".runtime-home");
  const cacheDir = resolve(workDir, ".runtime-cache");
  const nargoDir = resolve(workDir, ".runtime-nargo");
  await Promise.all([
    mkdir(homeDir, { recursive: true }),
    mkdir(cacheDir, { recursive: true }),
    mkdir(nargoDir, { recursive: true })
  ]);

  return {
    ...process.env,
    HOME: homeDir,
    XDG_CACHE_HOME: cacheDir,
    NARGO_HOME: nargoDir
  };
}

function publicInputsToBytes(publicInputs: string[]) {
  const hex = publicInputs
    .map((field, index) => {
      const clean = field.startsWith("0x") ? field.slice(2) : field;
      if (!/^[0-9a-fA-F]{1,64}$/.test(clean)) {
        throw new ProverError(500, "PROOF_GENERATION_FAILED", `Invalid public input field at index ${index}.`);
      }
      return clean.padStart(64, "0");
    })
    .join("");

  return Buffer.from(hex, "hex");
}

async function proveWithBbJs(workDir: string) {
  const [artifactText, witness] = await Promise.all([
    readFile(resolve(workDir, "target/stelakey_auth.json"), "utf8"),
    readFile(resolve(workDir, "target/stelakey_auth.gz"))
  ]);
  const artifact = JSON.parse(artifactText) as { bytecode?: unknown };

  if (typeof artifact.bytecode !== "string" || artifact.bytecode.length === 0) {
    throw new ProverError(500, "PROOF_GENERATION_FAILED", "Compiled Noir artifact is missing bytecode.");
  }

  const backend = new UltraHonkBackend(artifact.bytecode, { threads: 1 });
  try {
    const proofData = await backend.generateProof(witness, { keccak: true });
    const verified = await backend.verifyProof(proofData, { keccak: true });
    if (!verified) {
      throw new ProverError(500, "PROOF_GENERATION_FAILED", "Generated proof failed local verification.");
    }

    return {
      proofBytes: Buffer.from(proofData.proof),
      publicInputs: publicInputsToBytes(proofData.publicInputs)
    };
  } finally {
    await backend.destroy();
  }
}

function hasBbJsRuntimeAssets() {
  const copiedAssets = [
    resolve(appDir, ".next/barretenberg-threads.wasm.gz"),
    resolve(appDir, ".next/server/chunks/main.worker.js"),
    resolve(appDir, ".next/server/chunks/thread.worker.js")
  ];
  const packageAssets = [
    resolve(appDir, "node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz"),
    resolve(
      appDir,
      "node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/barretenberg_wasm_main/factory/node/main.worker.js"
    ),
    resolve(
      appDir,
      "node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/barretenberg_wasm_thread/factory/node/thread.worker.js"
    )
  ];

  return copiedAssets.every((asset) => existsSync(asset)) || packageAssets.every((asset) => existsSync(asset));
}

export function proverReadiness() {
  const missing: string[] = [];
  if (!existsSync(circuitDir)) missing.push("prover circuit");
  if (!existsSync(nargoBin)) missing.push("nargo binary");
  if (!hasBbJsRuntimeAssets()) missing.push("bb.js runtime assets");
  if (!process.env.PROVER_HMAC_SECRET && process.env.VERCEL) missing.push("prover HMAC secret");

  return {
    ok: missing.length === 0,
    service: "stelakey-prover",
    proofBackend: "noir-ultrahonk-bbjs",
    status: missing.length === 0 ? "ready" : "missing-config",
    missing
  };
}

export async function proverRuntimeReadiness() {
  const readiness = proverReadiness();
  let nargoRunnable = false;
  let nargoVersion: string | undefined;
  let nargoError: string | undefined;

  if (existsSync(nargoBin)) {
    try {
      const { stdout } = await execFileAsync(nargoBin, ["--version"], {
        env: process.env,
        maxBuffer: 1024 * 1024
      });
      nargoRunnable = true;
      nargoVersion = stdout.trim();
    } catch (error) {
      nargoError = commandFailureDetail(error);
      console.error("prover_nargo_health_failed", { detail: nargoError });
    }
  }

  const missing = [...readiness.missing];
  if (!nargoRunnable) missing.push("nargo executable");

  return {
    ...readiness,
    ok: readiness.ok && nargoRunnable,
    status: readiness.ok && nargoRunnable ? "ready" : "missing-config",
    nargoRunnable,
    ...(nargoVersion ? { nargoVersion } : {}),
    ...(nargoError ? { nargoError: "nargo could not execute in this runtime" } : {}),
    missing
  };
}

export function createChallenge(input: ChallengeInput) {
  const btcAddress = stringField(input.btcAddress, "btcAddress");
  const btcPubKey =
    typeof input.btcPubKey === "string" && input.btcPubKey.length > 0 ? input.btcPubKey : undefined;
  const walletProvider = enumField(input.walletProvider, "walletProvider", [
    "xverse",
    "leather",
    "unisat",
    "generic"
  ] as const);
  const purpose = enumField(input.purpose, "purpose", ["deploy", "transfer"] as const);
  const stellarNetwork = enumField(input.stellarNetwork, "stellarNetwork", ["testnet", "mainnet"] as const);
  const stellarIntentHash = hex32(input.stellarIntentHash, "stellarIntentHash");
  const signaturePayloadHash = hex32(input.signaturePayloadHash, "signaturePayloadHash");
  const networkHash = hex32(input.networkHash, "networkHash");
  const expiryLedger = positiveInteger(input.expiryLedger, "expiryLedger");

  const now = new Date();
  const expires = new Date(now.getTime() + 5 * 60 * 1000);
  const message = canonicalZkAuthorizationMessage({
    networkHash,
    signaturePayloadHash,
    stellarIntentHash
  });

  const payload: StoredChallenge = {
    btcAddress,
    ...(btcPubKey ? { btcPubKey } : {}),
    walletProvider,
    purpose,
    stellarNetwork,
    message,
    nonce: nodeCrypto.randomBytes(16).toString("hex"),
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    expiryLedger,
    domain: "StelaKey",
    replayKey: randomFieldHex(),
    messageHash: bitcoinSignedMessageHashHex(message),
    stellarIntentHash,
    signaturePayloadHash,
    networkHash
  };

  return {
    challengeId: signChallenge(payload),
    message: payload.message,
    nonce: payload.nonce,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    expiryLedger: payload.expiryLedger,
    domain: payload.domain,
    replayKey: payload.replayKey,
    messageHash: payload.messageHash,
    stellarIntentHash: payload.stellarIntentHash,
    signaturePayloadHash: payload.signaturePayloadHash,
    networkHash: payload.networkHash
  };
}

export async function createProof(input: ProofInput) {
  const readiness = proverReadiness();
  if (!readiness.ok) {
    throw new ProverError(503, "PROVER_NOT_CONFIGURED", `Prover is missing ${readiness.missing.join(", ")}.`);
  }

  const challengeId = stringField(input.challengeId, "challengeId");
  const btcAddress = stringField(input.btcAddress, "btcAddress");
  const btcPubKey = stringField(input.btcPubKey, "btcPubKey");
  const signatureText = stringField(input.signature, "signature");
  const signatureScheme = enumField(input.signatureScheme, "signatureScheme", [
    "ecdsa-message",
    "bip322",
    "schnorr"
  ] as const);

  if (signatureScheme !== "ecdsa-message") {
    throw new ProverError(422, "INVALID_SIGNATURE", "Only ECDSA message signatures are supported.");
  }

  const challenge = readChallenge(challengeId);
  if (challenge.btcAddress !== btcAddress) {
    throw new ProverError(403, "BTC_WALLET_MISMATCH", "Challenge wallet does not match proof wallet.");
  }
  if (challenge.btcPubKey && challenge.btcPubKey !== btcPubKey) {
    throw new ProverError(403, "BTC_WALLET_MISMATCH", "Challenge public key does not match proof public key.");
  }

  const signature = compactSignatureBytes(signatureText);
  const messageHash = bitcoinSignedMessageHash(challenge.message);
  const publicKey = hexToBytes(secp256k1PublicKeyParts(btcPubKey).uncompressedHex);
  const signatureOk = secp.verify(signature, messageHash, publicKey, {
    lowS: true,
    prehash: false
  });
  if (!signatureOk) {
    throw new ProverError(422, "INVALID_SIGNATURE", "Wallet signature did not verify.");
  }

  const proofId = nodeCrypto.randomUUID();
  const workDir = await mkdtemp(join(tmpdir(), "stelakey-proof-"));

  try {
    const nargoEnv = await writableNargoEnv(workDir);
    await cp(resolve(circuitDir, "src"), resolve(workDir, "src"), { recursive: true });
    await cp(resolve(circuitDir, "Nargo.toml"), resolve(workDir, "Nargo.toml"));

    const publicKeyParts = secp256k1PublicKeyParts(btcPubKey);
    const pubkeyX = hexToBytes(publicKeyParts.xHex);
    const pubkeyY = hexToBytes(publicKeyParts.yHex);
    const stellarIntentHash = bytes32FromHex(challenge.stellarIntentHash, "stellarIntentHash");
    const signaturePayloadHash = bytes32FromHex(challenge.signaturePayloadHash, "signaturePayloadHash");
    const networkHash = bytes32FromHex(challenge.networkHash, "networkHash");

    const proverToml = `# Generated by StelaKey prover for challenge ${proofId}.
# Contains user-supplied signature material. Do not commit this file.

pubkey_x = ${tomlByteArray(pubkeyX)}
pubkey_y = ${tomlByteArray(pubkeyY)}
sig_r = ${tomlByteArray(signature.slice(0, 32))}
sig_s = ${tomlByteArray(signature.slice(32, 64))}

stellar_intent_hash = ${tomlByteArray(stellarIntentHash)}
signature_payload_hash = ${tomlByteArray(signaturePayloadHash)}
network_hash = ${tomlByteArray(networkHash)}
expiry_ledger = "${challenge.expiryLedger}"
replay_key = "${fieldDecimalFromHex(challenge.replayKey)}"
wallet_scheme = "1"
`;

    await writeFile(resolve(workDir, "Prover.toml"), proverToml);
    await run(nargoBin, ["compile", "--force"], workDir, nargoEnv);
    await run(nargoBin, ["execute", "stelakey_auth"], workDir, nargoEnv);
    const { proofBytes, publicInputs } = await proveWithBbJs(workDir);

    return {
      proofId,
      status: "ready",
      ownerCommitment: `0x${ownerCommitmentHex(btcPubKey)}`,
      nullifier: `0x${challenge.replayKey}`,
      proofBytes: `0x${proofBytes.toString("hex")}`,
      publicInputs: `0x${publicInputs.toString("hex")}`,
      expiresAt: challenge.expiresAt
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

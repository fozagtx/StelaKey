import nodeCrypto from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import * as secp from "@noble/secp256k1";
import {
  bitcoinSignedMessageHash,
  bitcoinSignedMessageHashHex,
  bytesToHex,
  canonicalZkAuthorizationMessage,
  hexToBytes,
  ownerCommitmentHex,
  secp256k1PublicKeyParts
} from "@stelakey/crypto";
import { z } from "zod";
import type { ChallengeResponse, CreateProofResponse } from "@stelakey/shared";

const execFileAsync = promisify(execFile);
const port = Number.parseInt(process.env.PROVER_PORT ?? "3001", 10);
const origin = process.env.PROVER_ORIGIN ?? "http://localhost:3000";
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const circuitDir = resolve(rootDir, "circuits/stelakey_auth");
const nargoBin = process.env.NARGO_BIN ?? resolve(process.env.HOME ?? "", ".nargo/bin/nargo");
const bbBin = process.env.BB_BIN ?? resolve(process.env.HOME ?? "", ".bb/bb");

type StoredChallenge = ChallengeResponse & {
  btcAddress: string;
  btcPubKey?: string;
  walletProvider: string;
  purpose: "deploy" | "transfer";
  stellarNetwork: "testnet" | "mainnet";
};

const challenges = new Map<string, StoredChallenge>();

const challengeSchema = z.object({
  btcAddress: z.string().min(1),
  btcPubKey: z.string().optional(),
  walletProvider: z.enum(["xverse", "leather", "unisat", "generic"]),
  purpose: z.enum(["deploy", "transfer"]),
  stellarNetwork: z.enum(["testnet", "mainnet"]),
  operationHash: z.string().optional(),
  stellarIntentHash: z.string().optional(),
  signaturePayloadHash: z.string().optional(),
  networkHash: z.string().optional(),
  expiryLedger: z.number().int().positive().optional()
});

const proofSchema = z.object({
  challengeId: z.string().min(1),
  btcAddress: z.string().min(1),
  btcPubKey: z.string().min(1),
  signature: z.string().min(1),
  signatureScheme: z.enum(["ecdsa-message", "bip322", "schnorr"])
});

const app = express();
app.use(cors({ origin }));
app.use(express.json({ limit: "2mb" }));

function cleanHex(value: string, label: string) {
  const clean = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error(`${label} must be hex`);
  }
  return clean.toLowerCase();
}

function decodeSignature(value: string) {
  const trimmed = value.trim();
  if (/^(0x)?[0-9a-fA-F]+$/.test(trimmed) && cleanHex(trimmed, "signature").length % 2 === 0) {
    return hexToBytes(trimmed);
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

  throw new Error("Only compact 64-byte or recoverable 65-byte ECDSA signatures are supported.");
}

function bytes32FromHex(value: string, label: string) {
  const clean = cleanHex(value, label);
  if (clean.length !== 64) throw new Error(`${label} must be 32 bytes`);
  return hexToBytes(clean);
}

function tomlByteArray(bytes: Uint8Array) {
  return `[${Array.from(bytes).join(", ")}]`;
}

function randomFieldHex() {
  return bytesToHex(nodeCrypto.randomBytes(16));
}

function fieldDecimalFromHex(hex: string) {
  return BigInt(`0x${cleanHex(hex, "field")}`).toString(10);
}

function proofReject(
  errorCode: NonNullable<CreateProofResponse["errorCode"]>,
  status = 400
): [number, CreateProofResponse] {
  return [
    status,
    {
      proofId: nodeCrypto.randomUUID(),
      status: "rejected",
      errorCode
    }
  ];
}

async function run(command: string, args: string[], cwd: string) {
  try {
    await execFileAsync(command, args, {
      cwd,
      env: process.env,
      maxBuffer: 1024 * 1024 * 20
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "command failed";
    throw new Error(`${command} ${args.join(" ")} failed: ${message}`);
  }
}

async function generateProof(input: {
  challenge: StoredChallenge;
  btcPubKey: string;
  signature: Uint8Array;
}) {
  const proofId = nodeCrypto.randomUUID();
  const workDir = await mkdtemp(join(tmpdir(), "stelakey-proof-"));

  try {
    await cp(resolve(circuitDir, "src"), resolve(workDir, "src"), { recursive: true });
    await cp(resolve(circuitDir, "Nargo.toml"), resolve(workDir, "Nargo.toml"));

    const publicKey = secp256k1PublicKeyParts(input.btcPubKey);
    const pubkeyX = hexToBytes(publicKey.xHex);
    const pubkeyY = hexToBytes(publicKey.yHex);
    const stellarIntentHash = bytes32FromHex(input.challenge.stellarIntentHash, "stellarIntentHash");
    const signaturePayloadHash = bytes32FromHex(input.challenge.signaturePayloadHash, "signaturePayloadHash");
    const networkHash = bytes32FromHex(input.challenge.networkHash, "networkHash");

    const proverToml = `# Generated by StelaKey prover for challenge ${input.challenge.challengeId}.
# Contains user-supplied signature material. Do not commit this file.

pubkey_x = ${tomlByteArray(pubkeyX)}
pubkey_y = ${tomlByteArray(pubkeyY)}
sig_r = ${tomlByteArray(input.signature.slice(0, 32))}
sig_s = ${tomlByteArray(input.signature.slice(32, 64))}

stellar_intent_hash = ${tomlByteArray(stellarIntentHash)}
signature_payload_hash = ${tomlByteArray(signaturePayloadHash)}
network_hash = ${tomlByteArray(networkHash)}
expiry_ledger = "${input.challenge.expiryLedger}"
replay_key = "${fieldDecimalFromHex(input.challenge.replayKey)}"
wallet_scheme = "1"
`;

    await writeFile(resolve(workDir, "Prover.toml"), proverToml);
    await run(nargoBin, ["compile", "--force"], workDir);
    await run(nargoBin, ["execute", "stelakey_auth"], workDir);
    await run(
      bbBin,
      [
        "prove",
        "-s",
        "ultra_honk",
        "--oracle_hash",
        "keccak",
        "-b",
        "target/stelakey_auth.json",
        "-w",
        "target/stelakey_auth.gz",
        "-o",
        "target",
        "--output_format",
        "bytes_and_fields",
        "--verify"
      ],
      workDir
    );

    const [proofBytes, publicInputs] = await Promise.all([
      readFile(resolve(workDir, "target/proof")),
      readFile(resolve(workDir, "target/public_inputs"))
    ]);

    return {
      proofId,
      ownerCommitment: `0x${ownerCommitmentHex(input.btcPubKey)}`,
      proofBytes: `0x${proofBytes.toString("hex")}`,
      publicInputs: `0x${publicInputs.toString("hex")}`
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "stelakey-prover",
    proofBackend: "noir-ultrahonk",
    status: "ready"
  });
});

app.post("/api/challenges", (req, res) => {
  const parsed = challengeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_CHALLENGE_REQUEST", details: parsed.error.flatten() });
    return;
  }

  const now = new Date();
  const expires = new Date(now.getTime() + 5 * 60 * 1000);
  if (!parsed.data.stellarIntentHash || !parsed.data.signaturePayloadHash || !parsed.data.networkHash) {
    res.status(422).json({
      error: "AUTH_PAYLOAD_REQUIRED",
      message:
        "A real Soroban signature payload hash, Stellar intent hash, and network hash are required before creating a signable Bitcoin challenge."
    });
    return;
  }
  if (!parsed.data.expiryLedger) {
    res.status(422).json({
      error: "AUTH_EXPIRY_REQUIRED",
      message: "A real Soroban signature expiration ledger is required before creating a proof challenge."
    });
    return;
  }

  let message: string;
  try {
    message = canonicalZkAuthorizationMessage({
      networkHash: parsed.data.networkHash,
      signaturePayloadHash: parsed.data.signaturePayloadHash,
      stellarIntentHash: parsed.data.stellarIntentHash
    });
  } catch (error) {
    res.status(400).json({
      error: "INVALID_AUTH_PAYLOAD_HASH",
      message: error instanceof Error ? error.message : "Invalid authorization payload hash."
    });
    return;
  }

  const response: StoredChallenge = {
    challengeId: nodeCrypto.randomUUID(),
    btcAddress: parsed.data.btcAddress,
    walletProvider: parsed.data.walletProvider,
    purpose: parsed.data.purpose,
    stellarNetwork: parsed.data.stellarNetwork,
    message,
    nonce: nodeCrypto.randomBytes(16).toString("hex"),
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    expiryLedger: parsed.data.expiryLedger,
    domain: "StelaKey",
    replayKey: randomFieldHex(),
    messageHash: bitcoinSignedMessageHashHex(message),
    stellarIntentHash: parsed.data.stellarIntentHash,
    signaturePayloadHash: parsed.data.signaturePayloadHash,
    networkHash: parsed.data.networkHash,
    ...(parsed.data.btcPubKey ? { btcPubKey: parsed.data.btcPubKey } : {})
  };

  challenges.set(response.challengeId, response);
  res.json(response satisfies ChallengeResponse);
});

app.post("/api/proofs", async (req, res) => {
  const parsed = proofSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_PROOF_REQUEST", details: parsed.error.flatten() });
    return;
  }
  if (parsed.data.signatureScheme !== "ecdsa-message") {
    const [status, body] = proofReject("INVALID_SIGNATURE", 422);
    res.status(status).json(body);
    return;
  }

  const challenge = challenges.get(parsed.data.challengeId);
  if (!challenge) {
    const [status, body] = proofReject("PROOF_EXPIRED", 404);
    res.status(status).json(body);
    return;
  }
  if (challenge.btcAddress !== parsed.data.btcAddress) {
    const [status, body] = proofReject("BTC_WALLET_MISMATCH", 403);
    res.status(status).json(body);
    return;
  }
  if (challenge.btcPubKey && challenge.btcPubKey !== parsed.data.btcPubKey) {
    const [status, body] = proofReject("BTC_WALLET_MISMATCH", 403);
    res.status(status).json(body);
    return;
  }
  if (Date.now() > Date.parse(challenge.expiresAt)) {
    challenges.delete(challenge.challengeId);
    const [status, body] = proofReject("PROOF_EXPIRED", 410);
    res.status(status).json(body);
    return;
  }

  try {
    const signature = compactSignatureBytes(parsed.data.signature);
    const messageHash = bitcoinSignedMessageHash(challenge.message);
    const publicKey = hexToBytes(secp256k1PublicKeyParts(parsed.data.btcPubKey).uncompressedHex);
    const signatureOk = secp.verify(signature, messageHash, publicKey, {
      lowS: true,
      prehash: false
    });
    if (!signatureOk) {
      const [status, body] = proofReject("INVALID_SIGNATURE", 422);
      res.status(status).json(body);
      return;
    }

    const proof = await generateProof({
      challenge,
      btcPubKey: parsed.data.btcPubKey,
      signature
    });

    const response: CreateProofResponse = {
      proofId: proof.proofId,
      status: "ready",
      ownerCommitment: proof.ownerCommitment,
      nullifier: `0x${challenge.replayKey}`,
      proofBytes: proof.proofBytes,
      publicInputs: proof.publicInputs,
      expiresAt: challenge.expiresAt
    };
    res.json(response);
  } catch (error) {
    console.error("[prover] proof generation failed", error);
    const [status, body] = proofReject("INVALID_SIGNATURE", 500);
    res.status(status).json(body);
  }
});

app.listen(port, () => {
  console.log(`[prover] listening on http://localhost:${port}`);
});

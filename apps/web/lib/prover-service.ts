import nodeCrypto from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import * as secp from "@noble/secp256k1";
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
const circuitDepsDir = resolve(circuitDir, "deps");
const nargoBin = process.env.NARGO_BIN ?? resolve(appDir, ".prover-bin/nargo");
const bbBin = process.env.BB_BIN ?? resolve(appDir, ".prover-bin/bb");
const bbJsCliBin = process.env.BBJS_CLI_BIN ?? resolve(appDir, "node_modules/@aztec/bb.js/dest/node/main.js");
const PUBLIC_INPUT_BYTES = 3488;

function useBbJsBackend() {
  if (process.env.PROVER_BACKEND === "bbjs") return true;
  if (process.env.PROVER_BACKEND === "bb-cli") return false;
  return process.env.VERCEL === "1" || process.env.PROVER_NATIVE_BB === "0";
}

function proofBackendLabel() {
  return useBbJsBackend() ? "noir-ultrahonk-bbjs-wasm" : "noir-ultrahonk-bb-cli";
}

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

function fieldTextToBytes(value: string, index: number) {
  const trimmed = value.trim().replace(/^"|"$/g, "");
  if (!trimmed) {
    throw new ProverError(500, "PROOF_GENERATION_FAILED", `Empty public input field at index ${index}.`);
  }

  const parsed = trimmed.startsWith("0x") ? BigInt(trimmed) : BigInt(trimmed);
  const hex = parsed.toString(16);
  if (hex.length > 64) {
    throw new ProverError(500, "PROOF_GENERATION_FAILED", `Public input field at index ${index} exceeds 32 bytes.`);
  }
  return hex.padStart(64, "0");
}

function publicInputFileToBytes(bytes: Buffer) {
  const text = bytes.toString("utf8").trim();
  if (!text) {
    throw new ProverError(500, "PROOF_GENERATION_FAILED", "Public input file is empty.");
  }

  const jsonLike = text.startsWith("[") ? text : "";
  if (jsonLike) {
    try {
      const parsed = JSON.parse(jsonLike) as unknown;
      if (Array.isArray(parsed)) {
        return publicInputsToBytes(parsed.map((item) => String(item)));
      }
    } catch {
      // Fall through to token parsing below.
    }
  }

  const tokens = text.match(/0x[0-9a-fA-F]+|\b\d+\b/g);
  if (tokens && tokens.length > 0) {
    return Buffer.from(tokens.map(fieldTextToBytes).join(""), "hex");
  }

  return bytes;
}

function proofFileToBytes(bytes: Buffer) {
  const text = bytes.toString("utf8").trim();
  const clean = text.startsWith("0x") ? text.slice(2) : text;
  if (clean.length > 0 && clean.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(clean)) {
    return Buffer.from(clean, "hex");
  }
  return bytes;
}

async function readFirstExisting(paths: string[], label: string) {
  for (const path of paths) {
    if (existsSync(path)) return readFile(path);
  }
  throw new ProverError(500, "PROOF_GENERATION_FAILED", `${label} was not written by bb.`);
}

async function proveWithBbCli(workDir: string) {
  const crsPath = resolve(workDir, ".bb-crs");
  await mkdir(crsPath, { recursive: true });

  const targetDir = resolve(workDir, "target");
  const proofDir = resolve(targetDir, "bb-proof");
  await mkdir(proofDir, { recursive: true });

  await run(
    bbBin,
    [
      "prove",
      "--scheme",
      "ultra_honk",
      "--bytecode_path",
      resolve(targetDir, "stelakey_auth.json"),
      "--witness_path",
      resolve(targetDir, "stelakey_auth.gz"),
      "--output_path",
      proofDir,
      "--oracle_hash",
      "keccak",
      "--output_format",
      "bytes_and_fields",
      "--verify",
      "--crs_path",
      crsPath
    ],
    workDir
  );

  const [proofFile, publicInputsFile] = await Promise.all([
    readFirstExisting(
      [
        resolve(proofDir, "proof"),
        resolve(proofDir, "proof.bin"),
        resolve(proofDir, "proof.bytes"),
        resolve(proofDir, "proof.data")
      ],
      "Proof"
    ),
    readFirstExisting(
      [
        resolve(proofDir, "public_inputs"),
        resolve(proofDir, "public_inputs_fields"),
        resolve(proofDir, "public_inputs.json"),
        resolve(proofDir, "public_inputs.txt")
      ],
      "Public inputs"
    )
  ]);

  return {
    proofBytes: proofFileToBytes(proofFile),
    publicInputs: publicInputFileToBytes(publicInputsFile)
  };
}

async function proveWithBbJs(workDir: string) {
  const crsPath = resolve(workDir, ".bb-crs");
  const targetDir = resolve(workDir, "target");
  const proofPath = resolve(targetDir, "bb-proof-with-public-inputs");
  const verificationKeyPath = resolve(targetDir, "bb-vk");
  await mkdir(crsPath, { recursive: true });
  const bbEnv = {
    ...(await writableNargoEnv(workDir)),
    HARDWARE_CONCURRENCY: "1"
  };

  try {
    await run(
      process.execPath,
      [
        bbJsCliBin,
        "--crs-path",
        crsPath,
        "prove_ultra_keccak_honk",
        "--bytecode-path",
        resolve(targetDir, "stelakey_auth.json"),
        "--witness-path",
        resolve(targetDir, "stelakey_auth.gz"),
        "--output-path",
        proofPath
      ],
      workDir,
      bbEnv
    );

    await run(
      process.execPath,
      [
        bbJsCliBin,
        "--crs-path",
        crsPath,
        "write_vk_ultra_keccak_honk",
        "--bytecode-path",
        resolve(targetDir, "stelakey_auth.json"),
        "--output-path",
        verificationKeyPath
      ],
      workDir,
      bbEnv
    );

    await run(
      process.execPath,
      [
        bbJsCliBin,
        "--crs-path",
        crsPath,
        "verify_ultra_keccak_honk",
        "--proof-path",
        proofPath,
        "--vk",
        verificationKeyPath
      ],
      workDir,
      bbEnv
    );

    const proofWithPublicInputs = proofFileToBytes(await readFile(proofPath));
    if (proofWithPublicInputs.length <= PUBLIC_INPUT_BYTES) {
      throw new ProverError(500, "PROOF_GENERATION_FAILED", "Proof output did not contain public inputs.");
    }

    return {
      proofBytes: proofWithPublicInputs.subarray(PUBLIC_INPUT_BYTES),
      publicInputs: proofWithPublicInputs.subarray(0, PUBLIC_INPUT_BYTES)
    };
  } catch (error) {
    if (error instanceof ProverError) throw error;
    console.error("prover_bbjs_cli_failed", {
      detail: commandFailureDetail(error)
    });
    throw new ProverError(
      500,
      "PROOF_GENERATION_FAILED",
      "Authorization could not be completed because the proof service could not generate a valid proof. No transaction was submitted."
    );
  }
}

export function proverReadiness() {
  const missing: string[] = [];
  if (!existsSync(circuitDir)) missing.push("prover circuit");
  if (!existsSync(nargoBin)) missing.push("nargo binary");
  if (useBbJsBackend() && !existsSync(bbJsCliBin)) missing.push("bb.js CLI");
  if (!useBbJsBackend() && !existsSync(bbBin)) missing.push("bb binary");
  if (!process.env.PROVER_HMAC_SECRET && process.env.VERCEL) missing.push("prover HMAC secret");

  return {
    ok: missing.length === 0,
    service: "stelakey-prover",
    proofBackend: proofBackendLabel(),
    status: missing.length === 0 ? "ready" : "missing-config",
    missing
  };
}

export async function proverRuntimeReadiness() {
  const readiness = proverReadiness();
  let nargoRunnable = false;
  let nargoVersion: string | undefined;
  let nargoError: string | undefined;
  let bbRunnable = false;
  let bbVersion: string | undefined;
  let bbError: string | undefined;
  let bbJsLoadable = false;
  let bbJsError: string | undefined;

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

  if (useBbJsBackend()) {
    try {
      await execFileAsync(process.execPath, [bbJsCliBin, "--help"], {
        env: process.env,
        maxBuffer: 1024 * 1024
      });
      bbJsLoadable = true;
    } catch (error) {
      bbJsError = commandFailureDetail(error);
      console.error("prover_bbjs_health_failed", { detail: bbJsError });
    }
  } else if (existsSync(bbBin)) {
    try {
      const { stdout } = await execFileAsync(bbBin, ["--version"], {
        env: process.env,
        maxBuffer: 1024 * 1024
      });
      bbRunnable = true;
      bbVersion = stdout.trim();
    } catch (error) {
      bbError = commandFailureDetail(error);
      console.error("prover_bb_health_failed", { detail: bbError });
    }
  }

  const missing = [...readiness.missing];
  if (!nargoRunnable) missing.push("nargo executable");
  const backendRunnable = useBbJsBackend() ? bbJsLoadable : bbRunnable;
  if (!backendRunnable) missing.push(useBbJsBackend() ? "bb.js runtime" : "bb executable");

  return {
    ...readiness,
    ok: readiness.ok && nargoRunnable && backendRunnable,
    status: readiness.ok && nargoRunnable && backendRunnable ? "ready" : "missing-config",
    nargoRunnable,
    bbRunnable,
    bbJsLoadable,
    ...(nargoVersion ? { nargoVersion } : {}),
    ...(bbVersion ? { bbVersion } : {}),
    ...(nargoError ? { nargoError: "nargo could not execute in this runtime" } : {}),
    ...(bbError ? { bbError: "bb could not execute in this runtime" } : {}),
    ...(bbJsError ? { bbJsError: "bb.js could not load in this runtime" } : {}),
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
    if (existsSync(circuitDepsDir)) {
      await cp(circuitDepsDir, resolve(workDir, "deps"), { recursive: true });
    }

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
    const { proofBytes, publicInputs } = useBbJsBackend()
      ? await proveWithBbJs(workDir)
      : await proveWithBbCli(workDir);

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

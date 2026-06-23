import { createHash } from "node:crypto";
import { Point } from "@noble/secp256k1";
import { poseidon5 } from "poseidon-lite";

const STELAKEY_DOMAIN_TAG = 0x5354454c414b4559n;

export function hexToBytes(hex: string) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error("hex string must have an even length and contain only hex characters");
  }
  return Uint8Array.from(Buffer.from(clean, "hex"));
}

export function bytesToHex(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("hex");
}

function encodeBitcoinVarint(n: number) {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("varint input must be a non-negative safe integer");
  }
  if (n < 0xfd) return Uint8Array.from([n]);
  if (n <= 0xffff) return Uint8Array.from([0xfd, n & 0xff, (n >> 8) & 0xff]);
  if (n <= 0xffffffff) {
    return Uint8Array.from([0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
  }
  throw new Error("messages over 4 bytes of varint length are not supported");
}

function sha256(bytes: Uint8Array) {
  return Uint8Array.from(createHash("sha256").update(bytes).digest());
}

export function bitcoinSignedMessageHash(message: string) {
  const prefix = new TextEncoder().encode("\x18Bitcoin Signed Message:\n");
  const body = new TextEncoder().encode(message);
  const length = encodeBitcoinVarint(body.length);
  return sha256(sha256(Buffer.concat([prefix, length, body])));
}

export function bitcoinSignedMessageHashHex(message: string) {
  return `0x${bytesToHex(bitcoinSignedMessageHash(message))}`;
}

function normalizeHashHex(value: string, label: string) {
  const clean = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(`${label} must be a 32-byte hex string`);
  }
  return clean.toLowerCase();
}

export function canonicalZkAuthorizationMessage(input: {
  networkHash: string;
  signaturePayloadHash: string;
  stellarIntentHash: string;
}) {
  const networkHash = normalizeHashHex(input.networkHash, "networkHash");
  const signaturePayloadHash = normalizeHashHex(input.signaturePayloadHash, "signaturePayloadHash");
  const stellarIntentHash = normalizeHashHex(input.stellarIntentHash, "stellarIntentHash");

  return [
    "StelaKey v1",
    `network=0x${networkHash}`,
    `payload=0x${signaturePayloadHash}`,
    `intent=0x${stellarIntentHash}`,
    ""
  ].join("\n");
}

function cleanHex(value: string, label: string) {
  const clean = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error(`${label} must be hex`);
  }
  return clean.toLowerCase();
}

function bytes16Limb(hex32Bytes: string, offset: 0 | 16) {
  return BigInt(`0x${hex32Bytes.slice(offset * 2, offset * 2 + 32)}`);
}

function fieldToBytes32Hex(field: bigint) {
  const hex = field.toString(16);
  if (hex.length > 64) {
    throw new Error("owner commitment does not fit in 32 bytes");
  }
  return hex.padStart(64, "0");
}

export function secp256k1PublicKeyParts(publicKeyHex: string) {
  const clean = cleanHex(publicKeyHex, "publicKey");
  if (clean.length !== 66 && clean.length !== 130) {
    throw new Error("publicKey must be a compressed or uncompressed secp256k1 public key");
  }

  const point = Point.fromHex(clean);
  const uncompressedHex = point.toHex(false);

  return {
    uncompressedHex,
    xHex: uncompressedHex.slice(2, 66),
    yHex: uncompressedHex.slice(66, 130)
  };
}

export function ownerCommitmentHex(publicKeyHex: string) {
  const { xHex, yHex } = secp256k1PublicKeyParts(publicKeyHex);
  const commitment = poseidon5([
    bytes16Limb(xHex, 0),
    bytes16Limb(xHex, 16),
    bytes16Limb(yHex, 0),
    bytes16Limb(yHex, 16),
    STELAKEY_DOMAIN_TAG
  ]);

  return fieldToBytes32Hex(commitment);
}

import { sha256 } from "@noble/hashes/sha2";
import { concatBytes } from "@noble/hashes/utils";

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error("hex string must have an even length");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function encodeBitcoinVarint(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("varint input must be a non-negative safe integer");
  }
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) return new Uint8Array([0xfd, n & 0xff, (n >> 8) & 0xff]);
  if (n <= 0xffffffff) {
    return new Uint8Array([0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
  }
  throw new Error("messages over 4 bytes of varint length are not supported yet");
}

export function bitcoinSignedMessageHash(message: string): Uint8Array {
  const prefix = new TextEncoder().encode("\x18Bitcoin Signed Message:\n");
  const body = new TextEncoder().encode(message);
  const payload = concatBytes(prefix, encodeBitcoinVarint(body.length), body);
  return sha256(sha256(payload));
}

export function bitcoinSignedMessageHashHex(message: string): string {
  return `0x${bytesToHex(bitcoinSignedMessageHash(message))}`;
}

export type CanonicalZkAuthorizationMessageInput = {
  networkHash: string;
  signaturePayloadHash: string;
  stellarIntentHash: string;
};

function normalizeHashHex(value: string, label: string): string {
  const clean = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(`${label} must be a 32-byte hex string`);
  }
  return clean.toLowerCase();
}

export function canonicalZkAuthorizationMessage(input: CanonicalZkAuthorizationMessageInput): string {
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

export function canonicalZkAuthorizationMessageHashHex(input: CanonicalZkAuthorizationMessageInput): string {
  return bitcoinSignedMessageHashHex(canonicalZkAuthorizationMessage(input));
}

import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, canonicalZkAuthorizationMessage } from "./bitcoin";

export type StelaKeyIntent = {
  domain: "StelaKey";
  version: 1;
  networkPassphrase: string;
  accountContract: string;
  action: "deploy" | "transfer";
  operationHash: string;
  signaturePayloadHash?: string;
  nonce: string;
  expiresAt: string;
};

function sortedJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${sortedJson(item)}`).join(",")}}`;
}

export function canonicalIntent(intent: StelaKeyIntent): string {
  return sortedJson(intent);
}

export function intentHashHex(intent: StelaKeyIntent): string {
  return `0x${bytesToHex(sha256(new TextEncoder().encode(canonicalIntent(intent))))}`;
}

export function bitcoinMessageForIntent(intent: StelaKeyIntent): string {
  if (!intent.signaturePayloadHash) {
    throw new Error("signaturePayloadHash is required for the circuit-bound Bitcoin message");
  }

  return canonicalZkAuthorizationMessage({
    networkHash: `0x${bytesToHex(sha256(new TextEncoder().encode(intent.networkPassphrase)))}`,
    signaturePayloadHash: intent.signaturePayloadHash,
    stellarIntentHash: intentHashHex(intent)
  });
}

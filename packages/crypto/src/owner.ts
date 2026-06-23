import { Point } from "@noble/secp256k1";
import { poseidon5 } from "poseidon-lite";

const STELAKEY_DOMAIN_TAG = 0x5354454c414b4559n;

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

export type Secp256k1PublicKeyParts = {
  uncompressedHex: string;
  xHex: string;
  yHex: string;
};

export function secp256k1PublicKeyParts(publicKeyHex: string): Secp256k1PublicKeyParts {
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

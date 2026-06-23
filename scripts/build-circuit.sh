#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CIRCUIT_DIR="$ROOT_DIR/circuits/stelakey_auth"
NARGO_BIN="${NARGO_BIN:-$HOME/.nargo/bin/nargo}"
BB_BIN="${BB_BIN:-$HOME/.bb/bb}"

if [[ ! -x "$NARGO_BIN" ]]; then
  echo "nargo not found at $NARGO_BIN. Install Noir 1.0.0-beta.9 with noirup." >&2
  exit 1
fi

if [[ ! -x "$BB_BIN" ]]; then
  echo "bb not found at $BB_BIN. Install Barretenberg 0.87.0 with bbup." >&2
  exit 1
fi

echo "Using $("$NARGO_BIN" --version | head -n 1)"
echo "Using bb $("$BB_BIN" --version)"

cd "$CIRCUIT_DIR"
"$NARGO_BIN" compile --force

if [[ ! -f Prover.toml ]]; then
  echo "Compiled circuit only. No Prover.toml found, so no witness/proof was generated." >&2
  echo "Provide a real user witness generated from a connected wallet flow before producing proof artifacts." >&2
  exit 0
fi

"$NARGO_BIN" execute stelakey_auth
rm -rf target/proof target/proof_fields.json target/public_inputs target/public_inputs_fields.json target/vk target/vk_fields.json target/vk.soroban
"$BB_BIN" prove \
  -s ultra_honk \
  --oracle_hash keccak \
  -b target/stelakey_auth.json \
  -w target/stelakey_auth.gz \
  -o target \
  --output_format bytes_and_fields \
  --verify
"$BB_BIN" write_vk \
  -s ultra_honk \
  --oracle_hash keccak \
  -b target/stelakey_auth.json \
  -o target \
  --output_format bytes_and_fields

VK_SIZE="$(wc -c < target/vk | tr -d ' ')"
if [[ "$VK_SIZE" == "1760" ]]; then
  cp target/vk target/vk.soroban
elif [[ "$VK_SIZE" == "1764" ]]; then
  tail -c +5 target/vk > target/vk.soroban
else
  echo "Unexpected VK size: $VK_SIZE bytes. Expected 1764 from bb or 1760 for Soroban verifier." >&2
  exit 1
fi

echo "Generated target/proof, target/vk, and target/public_inputs."
echo "Generated target/vk.soroban for the Soroban UltraHonk verifier."

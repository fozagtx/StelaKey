#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

STELLAR_CLI="${STELLAR_CLI:-$HOME/.local/bin/stellar}"
STELLAR_RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
STELLAR_NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
STELLAR_NETWORK="${STELLAR_NETWORK:-testnet}"
DEPLOYER_IDENTITY="${STELAKEY_DEPLOYER_IDENTITY:-stelakey-testnet-deployer}"
MANIFEST_PATH="${STELAKEY_DEPLOYMENT_MANIFEST:-deployments/testnet.json}"

if [[ ! -x "$STELLAR_CLI" ]]; then
  echo "stellar CLI not found at $STELLAR_CLI. Install with: curl -fsSL https://github.com/stellar/stellar-cli/raw/main/install.sh | sh" >&2
  exit 1
fi

if [[ -n "${STELLAR_DEPLOYER_SECRET_KEY:-}" ]]; then
  SOURCE_ACCOUNT="$STELLAR_DEPLOYER_SECRET_KEY"
elif [[ "${STELAKEY_GENERATE_TESTNET_DEPLOYER:-0}" == "1" ]]; then
  if ! "$STELLAR_CLI" keys public-key "$DEPLOYER_IDENTITY" >/dev/null 2>&1; then
    "$STELLAR_CLI" keys generate "$DEPLOYER_IDENTITY" \
      --fund \
      --network "$STELLAR_NETWORK" \
      --rpc-url "$STELLAR_RPC_URL" \
      --network-passphrase "$STELLAR_NETWORK_PASSPHRASE" >/dev/null
  fi
  SOURCE_ACCOUNT="$DEPLOYER_IDENTITY"
else
  echo "No deployer configured." >&2
  echo "Set STELLAR_DEPLOYER_SECRET_KEY, or run with STELAKEY_GENERATE_TESTNET_DEPLOYER=1 for a funded testnet identity." >&2
  exit 1
fi

mkdir -p "$(dirname "$MANIFEST_PATH")"

echo "Building Soroban contracts..."
cargo build --workspace --target wasm32v1-none --release >/dev/null

ACCOUNT_WASM="target/wasm32v1-none/release/stelakey_account.wasm"
VERIFIER_WASM="target/wasm32v1-none/release/stelakey_verifier.wasm"
DEPLOYER_WASM="target/wasm32v1-none/release/stelakey_deployer.wasm"
VK_PATH="${STELAKEY_VK_PATH:-circuits/stelakey_auth/target/vk.soroban}"

if [[ ! -f "$VK_PATH" ]]; then
  echo "Verification key not found at $VK_PATH. Run bash scripts/build-circuit.sh first." >&2
  exit 1
fi

VK_HEX="$(xxd -p -c 999999 "$VK_PATH")"
VK_HASH="$(shasum -a 256 "$VK_PATH" | awk '{print $1}')"

echo "Uploading account WASM to $STELLAR_NETWORK..."
ACCOUNT_WASM_HASH="$("$STELLAR_CLI" contract upload \
  --wasm "$ACCOUNT_WASM" \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  --rpc-url "$STELLAR_RPC_URL" \
  --network-passphrase "$STELLAR_NETWORK_PASSPHRASE" \
  --optimize=false \
  --quiet)"

echo "Deploying UltraHonk verifier contract with VK..."
VERIFIER_CONTRACT_ID="$("$STELLAR_CLI" contract deploy \
  --wasm "$VERIFIER_WASM" \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  --rpc-url "$STELLAR_RPC_URL" \
  --network-passphrase "$STELLAR_NETWORK_PASSPHRASE" \
  --optimize=false \
  --quiet \
  -- \
  --vk_bytes "$VK_HEX")"

echo "Deploying account deployer contract..."
DEPLOYER_CONTRACT_ID="$("$STELLAR_CLI" contract deploy \
  --wasm "$DEPLOYER_WASM" \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  --rpc-url "$STELLAR_RPC_URL" \
  --network-passphrase "$STELLAR_NETWORK_PASSPHRASE" \
  --optimize=false \
  --quiet)"

DEPLOYER_PUBLIC_KEY="$("$STELLAR_CLI" keys public-key "$SOURCE_ACCOUNT" 2>/dev/null || true)"
DEPLOYED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

cat > "$MANIFEST_PATH" <<JSON
{
  "network": "$STELLAR_NETWORK",
  "rpcUrl": "$STELLAR_RPC_URL",
  "networkPassphrase": "$STELLAR_NETWORK_PASSPHRASE",
  "deployedAt": "$DEPLOYED_AT",
  "deployerPublicKey": "$DEPLOYER_PUBLIC_KEY",
  "accountWasmHash": "$ACCOUNT_WASM_HASH",
  "verificationKeyPath": "$VK_PATH",
  "verificationKeyBytes": $(wc -c < "$VK_PATH" | tr -d ' '),
  "verificationKeyHash": "$VK_HASH",
  "verifierContractId": "$VERIFIER_CONTRACT_ID",
  "deployerContractId": "$DEPLOYER_CONTRACT_ID",
  "status": "testnet-account-deployer-live",
  "notes": [
    "Verifier contract stores the generated UltraHonk verification key.",
    "Account WASM is uploaded.",
    "The deployerContractId deploys and initializes account contracts with owner commitment and verifier config.",
    "This manifest does not claim a working transfer flow."
  ]
}
JSON

cat > .env.testnet.local <<ENV
NEXT_PUBLIC_STELLAR_NETWORK=$STELLAR_NETWORK
NEXT_PUBLIC_STELLAR_RPC_URL=$STELLAR_RPC_URL
NEXT_PUBLIC_STELAKEY_VERIFIER_CONTRACT_ID=$VERIFIER_CONTRACT_ID
NEXT_PUBLIC_STELAKEY_DEPLOYER_CONTRACT_ID=$DEPLOYER_CONTRACT_ID
NEXT_PUBLIC_STELAKEY_ACCOUNT_WASM_HASH=$ACCOUNT_WASM_HASH
ENV

echo "Deployment manifest written to $MANIFEST_PATH"
echo "Verifier contract: $VERIFIER_CONTRACT_ID"
echo "Account deployer contract: $DEPLOYER_CONTRACT_ID"
echo "Account WASM hash: $ACCOUNT_WASM_HASH"
echo "Public env written to .env.testnet.local"

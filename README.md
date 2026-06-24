# stelakey

bitcoin wallet, stellar smart account, zk authorization.

connect a bitcoin wallet, create a stellar smart account, sign a stellar action, and use a zero-knowledge proof to authorize it on soroban. you sign every action. stelakey never holds your bitcoin private key.

live at [stelakey.vercel.app](https://stelakey.vercel.app/)

also available at [stelakey-fawuzan.vercel.app](https://stelakey-fawuzan.vercel.app/)

## what it does

use a bitcoin wallet as the control key for a stellar smart account.

- connect xverse, leather, unisat, or a compatible bitcoin wallet
- create or load a deterministic stellar contract account
- authorize stellar actions with a bitcoin wallet signature
- generate a noir/ultrahonk proof for the exact stellar action
- verify that proof through soroban account auth before execution
- keep the bitcoin private key, raw bitcoin signature, and raw bitcoin public key off-chain

the first app flow targets stellar testnet xlm transfers.

## how it works

the app prepares a stellar action, such as sending xlm.

stelakey hashes the exact soroban authorization payload, turns it into a canonical bitcoin-wallet message, and asks the connected bitcoin wallet to sign it.

the prover checks the bitcoin signature, runs the noir circuit, and returns proof bytes plus public inputs.

the stellar account contract implements `__check_auth`. when stellar asks the account to authorize the transfer, the contract checks the proof inputs and calls the ultrahonk verifier contract. if the proof does not match the account, network, payload, expiry, and wallet scheme, the action fails.

## zk math

the circuit proves this statement:

```text
i know a bitcoin secp256k1 public key Q = (x, y)
and an ecdsa signature (r, s)

such that:

ecdsa_secp256k1_verify(Q, r, s, bitcoin_hash(message)) = true

and:

owner_commitment =
  poseidon_bn254_hash_5(
    x_limb_0,
    x_limb_1,
    y_limb_0,
    y_limb_1,
    STELAKEY_TAG
  )
```

the bitcoin message hash is the standard signed-message hash:

```text
bitcoin_hash =
  sha256(sha256(
    "\x18Bitcoin Signed Message:\n" ||
    varint(message_length) ||
    message
  ))
```

the secp256k1 public key coordinates are split into 16-byte limbs so they fit cleanly into bn254 field elements:

```text
x -> x_limb_0, x_limb_1
y -> y_limb_0, y_limb_1
```

the public inputs bind the proof to the stellar action:

- `owner_commitment`
- `stellar_intent_hash`
- `signature_payload_hash`
- `network_hash`
- `expiry_ledger`
- `replay_key`
- `wallet_scheme`

the private witness contains the bitcoin public key coordinates and signature values needed to prove the statement. the stellar contract receives proof data and public hashes, not the raw bitcoin signature or raw public key.

## contracts

`contracts/account`

stellar smart account. implements `__check_auth`, stores the owner commitment, checks public inputs, and calls the verifier.

`contracts/deployer`

deterministic account deployer. uses the owner commitment as the account salt.

`contracts/verifier`

soroban ultrahonk verifier wrapper. stores the verification key and verifies proof bytes plus public inputs.

## stack

next.js, react, typescript, tailwind, local shadcn-style components, hugeicons, sats-connect for bitcoin wallets.

noir for the circuit. nargo for compile and witness execution. `@aztec/bb.js` for ultrahonk proving on the deployed app. bn254 poseidon for account commitments. secp256k1 ecdsa verification inside the circuit. soroban rust contracts on stellar testnet.

## testnet config

```text
network: stellar testnet
rpc: https://soroban-testnet.stellar.org
verifier contract: CCFJSBSDOOT65K56MNBLZLAPZ47ZJ64F3TKP4VNOTFXSCEMQ7P3A54LS
account deployer contract: CDG2AJMIVLEVBV2HE7KLK3LHOO6FVGHLEUW63ID2YK6O5755BHF62HZA
account wasm hash: a15735d74aa1c892063d75014bdc848ec9f7987813064b4b09c37cb6bc69646e
verification key hash: 6dfbb9837b001ef99c7b32afdfb9e488f6c15c24f7eea9e76291ee1916b1966b
```

## local development

```bash
pnpm install
pnpm dev:web
pnpm typecheck
pnpm build
```

build the circuit:

```bash
bash scripts/build-circuit.sh
```

## docs

protocol details: [docs/protocol.md](docs/protocol.md)

finish readiness: [docs/finish-readiness.md](docs/finish-readiness.md)

## contributing

prs are welcome.

for partnerships or questions, reach out at ibrahimpima76@gmail.com.

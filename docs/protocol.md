# StelaKey Protocol

This document describes the actual v1 protocol implemented in the repo. It separates the cryptographic statement from the product readiness status so the app never claims more than it has proven.

## Core Rule

The proof must bind a Bitcoin wallet signature to the exact Stellar authorization payload.

A proof that only says `ECDSA(pubkey, signature, message_hash)` is not enough. The circuit must also prove that `message_hash` came from the canonical StelaKey message containing the Stellar network hash, Soroban signature payload hash, and StelaKey intent hash.

## What ZK Does In This Project

In the current StelaKey MVP, ZK is the authorization bridge between a Bitcoin wallet and a Stellar smart account.

It proves:

- the holder of the Bitcoin key signed the exact StelaKey message
- the message is bound to the current Stellar authorization payload
- the Bitcoin key maps to the stored Poseidon owner commitment

It does not currently prove:

- a Bitcoin balance threshold such as "at least 1 BTC"
- a private BTC bridge deposit
- a private Stellar transfer
- a compliance/KYC credential
- lending or Trove Manager state

## Canonical Message

The wallet signs this text:

```text
StelaKey v1
network=0x{network_hash}
payload=0x{signature_payload_hash}
intent=0x{stellar_intent_hash}
```

There is a trailing newline after the `intent` line. With three 32-byte hashes encoded as lowercase hex, the current circuit message length is fixed at 236 bytes.

The Bitcoin signed-message digest is:

```text
bitcoin_hash =
  SHA256(SHA256(
    "\x18Bitcoin Signed Message:\n" ||
    varint(236) ||
    canonical_message
  ))
```

In the Noir circuit this appears as a 262-byte preimage:

```text
24-byte Bitcoin message prefix
1-byte message length
236-byte canonical message
```

## ZK Statement

The circuit proves:

```text
Given public:
  stellar_intent_hash
  signature_payload_hash
  network_hash
  expiry_ledger
  replay_key
  wallet_scheme

And private:
  pubkey_x
  pubkey_y
  sig_r
  sig_s

Prove:
  1. canonical_message =
       "StelaKey v1\n" ||
       "network=0x" || hex(network_hash) || "\n" ||
       "payload=0x" || hex(signature_payload_hash) || "\n" ||
       "intent=0x" || hex(stellar_intent_hash) || "\n"

  2. bitcoin_hash =
       SHA256(SHA256(bitcoin_signed_message_prefix || canonical_message_length || canonical_message))

  3. secp256k1_ecdsa_verify(pubkey_x, pubkey_y, sig_r, sig_s, bitcoin_hash) == true

  4. owner_commitment =
       Poseidon5_BN254(
         limb16(pubkey_x, 0),
         limb16(pubkey_x, 16),
         limb16(pubkey_y, 0),
         limb16(pubkey_y, 16),
         0x5354454c414b4559
       )
```

`0x5354454c414b4559` is the ASCII domain tag `STELAKEY`.

`limb16(bytes32, offset)` interprets a 16-byte big-endian chunk as a BN254 field:

```text
limb16(x, 0)  = x[0..16]
limb16(x, 16) = x[16..32]
```

## Public Outputs

The circuit returns these semantic public fields:

```text
[
  owner_commitment,
  limb16(stellar_intent_hash, 0),
  limb16(stellar_intent_hash, 16),
  limb16(signature_payload_hash, 0),
  limb16(signature_payload_hash, 16),
  limb16(network_hash, 0),
  limb16(network_hash, 16),
  expiry_ledger,
  replay_key,
  wallet_scheme
]
```

The Soroban account checks the fields it needs from the UltraHonk public-input blob:

- owner commitment
- signature payload hash limbs
- network hash limbs
- expiry ledger
- wallet scheme

The current account contract expects `wallet_scheme = 1`, meaning compact Bitcoin ECDSA message signature.

## Privacy Boundary

Hidden from Stellar on-chain state:

- raw Bitcoin public key
- raw Bitcoin signature
- Bitcoin private key

Public on-chain or submitted to contract auth:

- owner commitment
- Stellar intent hash limbs
- Soroban signature payload hash limbs
- network hash limbs
- expiry ledger
- replay key
- wallet scheme
- proof bytes

The app backend necessarily receives the public wallet key and wallet signature to generate the proof in the current server-prover architecture. The privacy claim is about what is revealed to Stellar verification, not about hiding the wallet from the web service.

## Stellar Intent Hash

The transfer service builds `stellar_intent_hash` from sorted JSON:

```text
{
  domain: "StelaKey",
  version: 1,
  networkPassphrase,
  accountContract,
  action: "transfer",
  operationHash,
  signaturePayloadHash,
  nonce,
  expiresAt: "ledger:{expiry_ledger}"
}
```

Then:

```text
stellar_intent_hash = SHA256(sorted_json(intent))
```

This gives the proof a stable commitment to the action the user saw and signed. The Soroban `signature_payload_hash` is still the strongest binding for what Stellar is actually authorizing, because it comes from the host authorization preimage.

## Soroban Account Checks

When Stellar needs account authorization, it calls:

```text
__check_auth(signature_payload, AuthProof, auth_context)
```

The account rejects unless:

1. `AuthProof.owner_commitment == stored owner_commitment`
2. `AuthProof.signature_payload_hash == signature_payload.to_bytes()`
3. current ledger sequence is not past `AuthProof.expires_ledger`
4. the proof public inputs contain the same owner commitment
5. the proof public inputs contain the same signature payload hash limbs
6. the proof public inputs contain the configured network hash limbs
7. the proof public inputs contain the same expiry ledger
8. the proof public inputs contain `wallet_scheme = 1`
9. the verifier contract accepts `public_inputs` and `proof_bytes`

If any check fails, the account returns an error and the Stellar action does not execute.

## Implemented Pieces

- Noir circuit verifies secp256k1 ECDSA over the canonical Bitcoin signed-message hash.
- Noir circuit computes the BN254 Poseidon owner commitment.
- Prover API verifies the wallet signature before spending prover time.
- Prover API runs `nargo compile`, `nargo execute`, and `@aztec/bb.js` UltraHonk proving.
- Prover API locally verifies the generated proof before returning it.
- Soroban account contract implements `__check_auth`.
- Soroban verifier contract stores an UltraHonk verification key and verifies proof bytes plus public inputs.
- Transfer submit path attaches proof data as Soroban account-auth signature data.

## Not Proven Complete Yet

- No real connected-wallet browser transfer has been confirmed on Stellar testnet.
- Negative contract tests for wrong owner, wrong payload, expired proof, replay, and malformed public inputs are still missing.

## Testnet Infrastructure

Deployed on Stellar testnet:

```text
Verifier contract:
CCFJSBSDOOT65K56MNBLZLAPZ47ZJ64F3TKP4VNOTFXSCEMQ7P3A54LS

Account deployer:
CDG2AJMIVLEVBV2HE7KLK3LHOO6FVGHLEUW63ID2YK6O5755BHF62HZA

Current account WASM hash:
a15735d74aa1c892063d75014bdc848ec9f7987813064b4b09c37cb6bc69646e

Verification key hash:
6dfbb9837b001ef99c7b32afdfb9e488f6c15c24f7eea9e76291ee1916b1966b
```

## Local Verification Commands

```bash
bash scripts/build-circuit.sh
```

## Caveats

- The current Noir SHA-256 dependency emits Brillig constraint-check warnings. This must be resolved or explicitly accepted before production/security claims.
- The web app account setup path creates account contracts through the live deployer only when the server signer is configured.
- BIP-322 and Schnorr are not implemented in the v1 proof path.

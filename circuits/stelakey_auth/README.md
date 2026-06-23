# StelaKey Noir Circuit

This circuit proves that a hidden secp256k1 key signed the canonical StelaKey Bitcoin message for a public Soroban authorization payload.

Implemented:

- builds a canonical message:
  - `StelaKey v1`
  - `network=0x...`
  - `payload=0x...`
  - `intent=0x...`
- computes Bitcoin Signed Message double-SHA256 inside Noir
- verifies low-s secp256k1 ECDSA with hidden pubkey/signature
- commits the hidden public key with Poseidon over 128-bit limbs
- outputs hashes as 128-bit limbs instead of lossy 256-bit field casts

Build the circuit:

```bash
bash scripts/build-circuit.sh
```

If a real connected-wallet witness has been generated, verify the resulting proof directly:

```bash
$HOME/.bb/bb verify -s ultra_honk \
  --oracle_hash keccak \
  -k circuits/stelakey_auth/target/vk \
  -p circuits/stelakey_auth/target/proof \
  -i circuits/stelakey_auth/target/public_inputs
```

Current caveat:

- The circuit uses `noir-lang/sha256 v0.1.0`, which compiles and proves but emits Noir Brillig constraint-check warnings. Do not treat this as production-audited until replaced, audited, or explicitly accepted.
- The prover service now accepts the supported `ecdsa-message` flow, verifies the wallet signature, and generates real proof artifacts. It still rejects unsupported signature schemes and invalid or expired challenges.

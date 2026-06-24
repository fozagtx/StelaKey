# Finish Readiness

Last checked: June 23, 2026.

## Verdict

StelaKey is not finished as a full end-to-end Bitcoin-authorized Stellar payment product.

The current build is a credible hackathon MVP foundation:

- Web landing is live, and protected app gates are implemented.
- Connected-wallet account setup is wired to the live Stellar testnet account deployer.
- The live same-origin prover route reports ready and is wired to Noir/UltraHonk.
- The account contract implements `__check_auth` binding checks.
- Production deployment `dpl_HLhjt9HWceuZ3JVPTgk47FvatoPz` is live at `https://web-fwc683k94-fawuzantechs-projects.vercel.app`.
- Public aliases `https://stelakey.vercel.app` and `https://stelakey-fawuzan.vercel.app` point to deployment `dpl_HLhjt9HWceuZ3JVPTgk47FvatoPz`.
- Public aliases `https://stelakey.vercel.app` and `https://stelakey-fawuzan.vercel.app` were pointed at that deployment on June 23, 2026.
- Latest app-shell UI pass removes the visible Dashboard sidebar item, keeps the collapsed sidebar as a clickable icon rail, removes unwanted sidebar hover/click movement animations, adds a dedicated StelaKey mark, tightens Transfer spacing, and removes duplicate protected-page header labels.
- Production proof attempts exposed several real serverless prover blockers: Nargo cache writes, missing runtime `git`, bb.js CRS path creation, native `bb` requiring `GLIBC_2.38`, and missing bb.js WASM/worker files in the function bundle. Current source fixes these by forcing Nargo cache/home paths into writable temporary directories, vendoring Noir dependencies as local path dependencies copied into each proof job, using the `@aztec/bb.js` WASM backend on Vercel, and tracing the exact bb.js pnpm runtime files needed by `/api/proofs` and `/api/prover/health`.

The remaining blocker is the real connected-wallet transfer path:

- Same-origin web transfer `prepare-auth` and `submit` routes are implemented. Local terminal checks fail closed without a signer; the live transfer health endpoint reports `prepare-auth-ready`.
- `/api/challenges` and `/api/proofs` are implemented same-origin and configured for Noir/UltraHonk through `@aztec/bb.js`.
- No real browser-to-Stellar payment transaction is complete yet.
- No fixture wallet, generated key, or test identity was used to substitute for this missing real wallet action.

## Command Checks

| Check | Result | Notes |
| --- | --- | --- |
| `pnpm -s -C apps/web typecheck` | Pass | Web app TypeScript typecheck passes after prover and UI changes. |
| `pnpm -s -C apps/web build` | Pass | Next build passes with the exact bb.js pnpm runtime files traced for prover routes. |
| `pnpm -r test` | Pass | Current package test scripts are typecheck-based. |
| `cargo build --workspace --target wasm32v1-none` | Pass | Soroban contracts and verifier crate build to wasm target. |
| `cargo test --workspace` | Pass | Default Rust tests pass. |
| `bash scripts/build-circuit.sh` | Pass | Noir compiles with known SHA-256 Brillig warnings; script exits without generating proof artifacts because no real `Prover.toml` witness is present. |
| Local bb.js proof smoke | Pass | `PROVER_BACKEND=bbjs createProof()` with a throwaway local key returned `status: ready`, proof hex length `29186`, and public-input hex length `6978` (`3488` bytes), matching the account contract public-input size. No chain state was created. |
| Live prover readiness | Pass | `https://stelakey.vercel.app/api/prover/health` and `https://stelakey-fawuzan.vercel.app/api/prover/health` report `ready` with `noir-ultrahonk-bbjs-wasm`, `nargo version = 1.0.0-beta.9`, and no missing config on deployment `dpl_HLhjt9HWceuZ3JVPTgk47FvatoPz`. |
| Live `https://stelakey.vercel.app` | Pass | Public landing responds with the user-facing wallet-to-Stellar promise. |
| Live protected routes | Inconclusive | Static terminal fetches return 200, but protected-route gating needs a hydrated browser session to verify. Browser control was not used. |
| Live account deploy readiness | Pass | `/api/accounts/deploy` reports ready with deployer, verifier, and fixed account WASM hash. |
| Incomplete account POST | Pass | Rejects missing wallet fields instead of fabricating a deployment. |
| Same-origin transfer `prepare-auth` typecheck | Pass | Web API route builds the real XLM/SAC transfer authorization payload path in TypeScript. |
| Same-origin transfer `submit` typecheck | Pass | Web API route attaches proof data to the prepared Soroban auth entry and signs/sends only through the configured signer path. |
| Local transfer missing-signer check | Pass | `/api/transfers/health` reports `missing-config`; `/api/transfers/prepare-auth` and `/api/transfers/submit` reject with `RELAYER_NOT_CONFIGURED`; no signing or transaction happens. |
| Live transfer readiness | Pass | `https://stelakey.vercel.app/api/transfers/health` reports `prepare-auth-ready` with no missing config. |
| Incomplete live transfer POST | Pass | Production `/api/transfers/prepare-auth` and `/api/transfers/submit` reject empty requests with `INVALID_TRANSFER_REQUEST`; no transaction is prepared or submitted. |
| Landing image/deploy pass | Pass | Production aliases serve the generated step/footer PNGs; old hero quick-strip copy is absent. |
| UI transient errors | Pass | Wallet/account/payment transient errors render through toast components instead of inline hero/protected-flow notices. Raw provider-selection copy is sanitized before display. |
| Transfer stale-payload guard | Pass | Changing recipient, amount, asset, or issuer clears the prepared challenge, signature, proof, and submitted state before another submit can happen. |
| Submit hash guard | Pass | The transfer UI records success only when submit returns `status: "submitted"` and a real `txHash`. |
| Rejected proof shape | Pass | Rejected `/api/proofs` responses no longer return a synthetic `proofId`; a proof ID appears only on a ready proof response. |
| Sidebar/app-shell UI build | Pass | Source and production build include a dedicated StelaKey mark, no visible Dashboard sidebar nav item, a collapsed icon rail for Account/Transfer/Activity, and reduced-motion support for sidebar transitions. |
| Vercel prover runtime paths | Pass | Current production uses `@aztec/bb.js` WASM instead of the incompatible native Linux `bb` binary, and the function trace includes the exact bb.js pnpm runtime assets. A production proof POST was not run with a fixture wallet because project rules forbid fixture-created proof records on deployed URLs. |
| Stub endpoint removal | Pass | Standalone relayer 501 `*_NOT_IMPLEMENTED` endpoints were removed; stale RISC0/Circom fallback README files and RISC0 env hint were removed. |

## PRD Acceptance Criteria

| Requirement | Status | Evidence |
| --- | --- | --- |
| Visitor opening `/` sees only public overview and app entry | Pass | Landing HTML contains public product copy and no protected app route labels. |
| Visitor opening protected routes sees only wallet gate | Inconclusive | The intended gate is implemented in the app shell, but terminal-only static HTML is not enough to certify the hydrated route behavior. |
| Connected user sees sidebar and wallet chip | Partial | Implemented in app shell; not re-tested with a real browser wallet in this check because browser control was not used. |
| Transfer page cannot request proof without signed challenge | Pass | Buttons and code gate proof generation on signature state. |
| Proof rejection cannot show success | Pass | Prover errors produce rejected status; transfer UI records stopped authorization and submits no transaction. |
| No fake testnet tx hash shown | Pass | No web route renders hardcoded hashes; transfer shows a tx hash only from the relayer submit response. |
| Prepared payment cannot drift from visible form fields | Pass | Any edit to recipient, amount, asset, or issuer clears the old auth payload and proof state. |
| shadcn/ui foundation with supplied design system | Pass | App uses local shadcn-style UI primitives and the supplied blue/white system. |
| No lucide icons | Pass | Source imports Hugeicons only. |
| Account setup is live | Pass | Live readiness endpoint is configured; POST rejects invalid input. Existing per-wallet deployments are returned only from the real account lookup. |
| Full Bitcoin-authorized Stellar transfer | Fail | Same-origin prover, `prepare-auth`, and `submit` code exist; no real connected wallet has completed a browser-to-Stellar transfer yet. |

## ZK Status

Done:

- Noir circuit compiles and produces proof artifacts.
- Local UltraHonk proof verifies.
- Public prover health is ready on both production aliases.
- Prover API validates an ECDSA Bitcoin-message signature and is wired to return proof bytes/public inputs for real connected-wallet challenges.
- Testnet verifier contract is deployed.
- Account contract checks owner commitment, signature payload hash, network hash, expiry ledger, and wallet scheme before calling verifier.
- The circuit binds the Bitcoin message to `network_hash`, `signature_payload_hash`, and `stellar_intent_hash`.
- The owner commitment is computed as BN254 Poseidon `hash_5(pubkey_x_limb0, pubkey_x_limb1, pubkey_y_limb0, pubkey_y_limb1, STELAKEY)`.

Not done:

- Same-origin web transfer routes and production prover are deployed and ready, but still need a real connected-wallet proof and submit retry before a transfer can be confirmed.
- No real transfer transaction hash can be shown yet.

## Known Coverage Gaps

- Rust contract tests for wrong owner, wrong payload, expired proof, replay, and wrong public inputs are still missing.
- Browser wallet flows were not re-tested through a real Xverse/UniSat extension in this check.
- Mobile visual layout was checked through CSS/build/static analysis only, not browser screenshots.

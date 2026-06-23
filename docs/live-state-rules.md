# Live State Rule

Do not show mocks, local fixtures, or simulations as deployed behavior.

Soroban RPC preflight is allowed only for its required network role: collecting
footprint, resource fee, and authorization-entry data before a real transaction
is signed and submitted. Preflight output must never be presented as a confirmed
payment, proof success, balance, explorer link, or deployed user state.

Allowed only in isolated tests that are never shown as product behavior:

- unit-test doubles
- local-only contract tests
- compiler artifacts that are not presented as user state

Never allowed:

- fake proof success
- fake transaction hashes
- fake explorer links
- mock balances labeled as testnet balances
- hardcoded successful deploy or transfer states
- fixture wallets or generated accounts in deployed/live flows
- simulation/no-send results presented as product success

Every judge-facing success claim needs a real artifact from the live flow being claimed: deployed contract ID, confirmed testnet transaction hash, user-signed proof artifact, verifier result, or service response from the deployed app.

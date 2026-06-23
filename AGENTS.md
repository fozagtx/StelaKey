# Project Rules

## Strict Live-Flow Rule

- Never use fixture keys, demo wallets, generated test accounts, mock accounts, or simulation-only identities to exercise user-facing live flows on testnet, mainnet, production, or deployed preview URLs unless the user explicitly approves that exact action in the current turn.
- Do not POST account setup, submit transactions, deploy contracts, create proof records, or create explorer-visible state from fixture/demo data as a substitute for a real connected user wallet.
- Do not present fixture-created contracts, hashes, explorer links, balances, proofs, or activity as product/user state.
- If live verification needs a wallet-controlled action and no real user wallet is available, stop and ask for approval or show the feature as unavailable. Do not improvise with fixture data.

## No Fake Product State

- No fake proof success.
- No fake transaction hashes.
- No fake balances.
- No fake explorer links.
- No hardcoded successful deploy or transfer states.

## No Browser Control

- Do not open, control, inspect, or automate the user's browser unless the user explicitly asks for browser use in the same turn.
- Use terminal-only checks such as build, typecheck, curl, or deployment logs when verification is needed and browser use has not been explicitly approved.

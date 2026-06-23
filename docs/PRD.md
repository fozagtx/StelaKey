# StelaKey Product Requirements Document

## Product

StelaKey lets a user control a Stellar smart account with an existing Bitcoin wallet. The user signs a Stellar authorization intent with their Bitcoin wallet, generates a zero-knowledge proof, and submits a Stellar action only after proof verification.

## Non-Negotiables

- Do not build app pages before the route map, permission matrix, and user flows are defined here.
- Do not show fake proof success, fake balances, fake transaction hashes, or fake explorer links.
- Never use fixture keys, demo wallets, generated test accounts, mock accounts, or simulation-only identities to exercise user-facing live flows on testnet, mainnet, production, or deployed preview URLs unless the user explicitly approves that exact action in the current turn.
- Do not POST account setup, submit transactions, deploy contracts, create proof records, or create explorer-visible state from fixture/demo data as a substitute for a real connected user wallet.
- Do not expose dashboard, transfer, account, or activity links from the public landing page.
- Do not use gradients in the app UI.
- Use shadcn/ui as the UI component foundation for React/Next app screens.
- Do not use lucide-react icons in the web UI. Use `@hugeicons/react` with `@hugeicons/core-free-icons` for app icons, including sidebar navigation, page headers, buttons, and major states.
- Keep contract security separate from browser route gating. Browser gates improve UX; Soroban `__check_auth` enforces asset control.

## Users

### Visitor

Not connected to a Bitcoin wallet.

Can:

- View public landing page.
- Read product overview.
- Click app entry points.
- See a wallet connection gate on protected app routes without seeing dashboard navigation, account content, transfer controls, or activity content.

Cannot:

- View account details.
- Prepare transfer authorizations.
- Generate proofs.
- See activity logs tied to an account.
- See balances or transaction history.

### Connected User

Connected with a supported Bitcoin wallet.

Can:

- View dashboard.
- View account derivation/status.
- Prepare Stellar authorization intent.
- Sign the authorization with Bitcoin wallet.
- Request proof generation.
- Submit transfer only after proof service returns a real proof.
- View real activity returned by services.
- Keep their connected wallet identity across refreshes through browser-stored public wallet metadata.

Cannot:

- Bypass proof verification.
- See hardcoded success states.
- Submit if proof is rejected, expired, replayed, or mismatched.

Session behavior:

- Store only public wallet session metadata: provider, address, public key, and network.
- Do not store private keys, signatures, proof witnesses, or secrets.
- Restore the wallet session after refresh before showing protected-route wallet gates.
- During restore, show a neutral restoring state instead of a Connect Wallet prompt.
- Disconnect must clear the stored wallet session.

### Relayer Operator

Service operator that sponsors/submits Stellar testnet transactions.

Can:

- Prepare Stellar authorization payloads through Stellar RPC preflight.
- Attach user proof payloads.
- Submit verified transactions.

Cannot:

- Change recipient, amount, asset, network, account, or invocation after the user signs.
- Turn rejected proof into successful UI state.

## Route Map And Permissions

| Route | Purpose | Visitor | Connected User | Notes |
| --- | --- | --- | --- | --- |
| `/` | Public landing page | Allowed | Allowed | Connect wallet only. No protected route links. No dashboard widgets. |
| `/dashboard` | App overview | Full-page wallet gate only | Allowed | Visitor must not see sidebar, dashboard cards, account status, or transfer entry. |
| `/account` | Smart account status | Full-page wallet gate only | Allowed | Visitor must not see account content. No fake balances or contract IDs. |
| `/transfer` | Prepare, sign, prove, submit transfer | Full-page wallet gate only | Allowed | Visitor must not see transfer form. Must bind action hash to signed intent. |
| `/activity` | Proof/transaction history | Full-page wallet gate only | Allowed | Visitor must not see event history UI. Empty state only after connection. |
| `/api/challenges` | Prepare challenge | Reject if required wallet fields missing | Allowed | Returns challenge only, not proof success. |
| `/api/proofs` | Generate proof | Reject | Allowed | Must fail closed until real prover works. |
| `/api/accounts/*` | Account preview/deploy | Reject | Allowed | Must not fabricate contract IDs. |
| `/api/transfers/*` | Submit transfers | Reject | Allowed | Must not submit without real proof. |

### Account Setup API

Purpose:

- Deploy a Stellar account contract for the connected Bitcoin wallet only after the server can create a real Stellar testnet transaction.

Required:

- `/api/accounts/deploy` accepts the connected Bitcoin address, public key, provider, and network.
- Reject requests with missing wallet fields.
- Derive `owner_commitment` from the Bitcoin public key with the same Poseidon BN254 `hash_5` shape used by the Noir circuit.
- Do not deploy with a placeholder, SHA-only substitute, fixture key, or random commitment.
- Invoke the live testnet account deployer contract.
- Return a contract ID and explorer link only after Stellar RPC confirms the deployment transaction succeeded.
- Return an error state if the server signer, deployer contract ID, account WASM hash, verifier contract ID, or RPC call is unavailable.
- If Stellar rejects setup, return a safe failure reason such as sequence collision, insufficient signer balance, insufficient fee, resource limit, archived entry, or contract rejection. Do not collapse all failures into a generic rejection message.
- If Stellar rejects setup with a server-signer sequence collision, the API must re-check account state and retry with a freshly loaded Stellar source-account sequence before returning an error to the UI.
- After any Stellar rejection, re-check the deterministic account address before showing failure, because another in-flight transaction may have created the account.
- Never expose the server signer secret to the browser.

## Required Pages

### Landing Page

Purpose:

- Explain what StelaKey does.
- Offer entry into app.
- Avoid operational controls.
- Keep the supplied blue outer frame and white brand/copy surfaces, but make the white landing panel the main experience.

Required:

- Clear product promise.
- Bitcoin wallet connect button as the primary action.
- Bitcoin wallet connect button visible in the main hero area.
- Wallet connect must request real browser-wallet permission from the supported provider; it must not only read cached accounts.
- Connect Wallet opens the supported Sats Connect provider selector instead of a hand-built modal.
- Xverse must work through the selector; UniSat remains a supported option when the installed provider supports it.
- The selected provider owns later message signing; transfer signing must not be hardwired to one wallet.
- Successful wallet connection from the landing page must immediately redirect to `/dashboard`.
- The landing page must not show a connected-wallet status chip or post-connect holding state.
- Explain the product in user language: bring your Bitcoin wallet to Stellar.
- Do not show protocol names, verifier jargon, proving-system names, or internal architecture labels on the public landing page.
- No generic numbered explainer cards. If the landing explains the flow, it must be image-led and use generated bitmap artwork in the approved editorial storybook style.
- No public header links to `/dashboard`, `/account`, `/transfer`, or `/activity`.
- No transfer form.
- No fake stats.
- No alternate landing color palette.
- No right-side blue visual panel.
- No separate blue menu/nav tile with copy such as "Open Stellar with your Bitcoin wallet."
- Desktop landing hero must fit in the first viewport without forcing the user to scroll to understand the product or reach Connect Wallet. Additional sections may continue below the fold.
- Landing hero artwork must use a generated bitmap image asset, not an SVG substitute.
- Landing hero artwork must include the official Stellar logo symbol where Stellar is represented.
- Hero artwork must feel integrated with the page, not like a boxed image/card. Prefer an unframed editorial scene with the same warm background as the page.
- Add a public "How it works" section below the hero using user-language steps: connect Bitcoin wallet, create a Stellar account, authorize payments. Do not expose prover/verifier jargon as section copy.
- The "How it works" section must use generated bitmap artwork in the same editorial storybook style as the hero, with no fake UI data.
- Each how-it-works step card must have its own generated bitmap illustration. Do not use icons or SVG placeholders as the image treatment for these cards.
- Remove the hero quick-strip/chip row such as "Connect / Create / Control" or equivalent utility chips.
- Add a footer that matches the editorial storybook design, provides product summary, public links, technical docs links, and legal placeholders. The footer must not expose protected app navigation as primary landing nav.
- Footer/CTA area must include its own generated bitmap artwork in the same style. Do not leave the footer as a plain link block only.
- Wallet connection errors, provider-selection cancellations, and signing rejections must render as a small toast using the project design system. Do not place these transient errors inline inside the hero or make them part of the landing copy.

### Dashboard

Purpose:

- Connected user's control center.

Required:

- App shell must use the local shadcn/ui sidebar component, not a hand-rolled aside/nav block.
- Sidebar navigation should contain brand and route links only; do not add explanatory status cards to the sidebar.
- Connected wallet identity and disconnect controls belong in the sidebar, not in a topbar that pushes protected route content down the page.
- Protected app sidebar must be a detached rounded panel with a visible page gutter. It must not be glued flush to the viewport edge or span as a square strip.
- Protected app sidebar must be horizontally resizable on desktop, with width stored locally for the browser session/user.
- Protected app sidebar must have a visible icon button to collapse and reopen the sidebar. A thin drag strip alone is not enough as the only visible control.
- Collapsed sidebar must remain useful: show a clickable icon rail for Account, Transfer, and Activity instead of a blank rail.
- Sidebar route navigation must not include a visible Dashboard item. The brand mark may link back to `/dashboard`.
- Sidebar brand must use a dedicated StelaKey mark next to the StelaKey wordmark when expanded, and the mark only when collapsed. Do not combine Bitcoin and Stellar official logos into the StelaKey app logo.
- Sidebar open/close motion must be under 300ms, use a custom easing curve, and respect `prefers-reduced-motion`.
- Protected route headers must avoid duplicate label/title stacks such as "StelaKey account" followed by "Account" or "Transfer" followed by another transfer heading.
- Wallet identity chip.
- Account status.
- Proof path status.
- Transfer entry point.
- Security/live-state status.

### Account

Purpose:

- Show smart account derivation/deployment state.

Required:

- Owner commitment status.
- Verifier status.
- Real XLM balance for the deployed StelaKey contract account.
- Contract ID only after real deployment.
- Contract ID must be copyable in full wherever the user needs to fund, inspect, or share the StelaKey account address.
- Explorer link only after real contract exists.
- The primary account view should feel like a Privy account viewer: compact identity panel, wallet/account rows, copy controls, balance, and a few clear actions. Do not foreground internal service contract IDs on this page.
- Do not show internal build-status wording like "not deployed from the web app yet."
- While account status or setup data is still loading, show a neutral loading state such as "Checking your Stellar account" or "Setting up your account." Do not show "Setup unavailable," "Unavailable," or an error-style state until the request has completed and the service is actually unavailable or rejected.
- If per-user account setup is available, the setup CTA must call `/api/accounts/deploy` and show the returned contract ID only after success.
- If a deterministic account already exists for the connected wallet, show "Account already exists" and remove the create CTA.
- If per-user account setup is unavailable, present "Setup unavailable" and remove setup CTAs. Do not say "Ready to set up" unless the button actually deploys an account.
- If the account exists but has no XLM, show a testnet funding action that sends real testnet XLM to the StelaKey contract account through the configured funding signer. Show the transaction link only after Stellar confirms it.
- The account page must also show a copyable StelaKey contract address so the user can fund or inspect it externally before attempting transfers.
- The funding endpoint must verify that the requested contract address belongs to the connected Bitcoin public key before sending testnet XLM.

### Transfer

Purpose:

- Prepare and authorize Stellar transfer.
- User-facing labels should say Prepare, Sign, Authorize, and Payment status. Do not use proof/verifier/prover/relayer labels as primary button or panel text.

Required flow:

1. User creates or already has a deployed StelaKey account contract.
2. User enters recipient, asset, and amount.
3. App requests a real Stellar authorization payload from the relayer for the deployed StelaKey account.
4. Relayer prepares the exact Stellar Asset Contract transfer through Stellar RPC and returns operation hash, signature payload hash, network hash, expiry ledger, auth entry XDR, and unsigned transaction XDR.
5. User requests challenge.
6. User signs with Bitcoin wallet.
7. Prover generates real proof.
8. Relayer submits only after proof verifies and the proof is attached to the Soroban auth entry.
9. UI shows real transaction hash only after submission.
10. UI shows the StelaKey account XLM balance before preparing an XLM transfer.
11. If the XLM balance is lower than the requested XLM amount, block Prepare and tell the user to fund the account first. Do not wait for a low-balance Stellar preflight error.

Current asset scope:

- XLM transfer authorization is the first live relayer target.
- Non-XLM assets must include a real issuer account before the relayer can build a Stellar Asset Contract ID.
- The UI must not default to USDC unless the issuer is collected or hard-configured for a real testnet asset.

Current implementation status:

- Transfer page looks up the connected wallet's deployed account before preparing authorization.
- Same-origin web API transfer `prepare-auth` must be available so the deployed app does not depend on an undeployed relayer URL.
- Transfer `prepare-auth` must build a real Stellar SAC transfer authorization payload.
- Transfer preparation errors must not expose internal RPC/preflight labels such as simulation. The UI must say the payment could not be prepared and include a concrete reason when available, such as invalid recipient, missing recipient account, unsupported asset, or Stellar RPC rejection.
- Proof-generation errors must not expose internal command names such as `PROVER_COMMAND_FAILED`, raw binary paths, or stack details. The UI should say authorization could not be completed, that no transaction was submitted, and, when accurate, that the user can try again after the service records the error.
- Transfer `submit` must attach `AuthProof` to the auth entry before signing/sending.
- The submit path is not live-finished until a real connected wallet signs the transfer challenge and a real Stellar transaction confirms from the browser flow.

### Activity

Purpose:

- Show real account and payment events.

Required:

- Empty state when no events exist.
- Activity page must use one clear page title and one empty state. Do not repeat "Activity", "history", or empty-state language through duplicate badges, titles, and icons.
- Activity empty state should be restrained and text-led unless real event data exists. Do not add decorative icons just to fill space.
- Real authorization or proof IDs only when returned by real services.
- Real Stellar transaction hashes only.
- Real explorer links only.

## UI Requirements

- Use shadcn/ui components for buttons, cards, dialogs, forms, inputs, tabs, badges, sidebars, sheets, toasts, and tables.
- Use the supplied Instrument-style design system across landing and app pages:
  - Visual DNA: editorial storybook SaaS, massive whitespace, warm human tone, asymmetrical composition, thick-line flat illustrations.
  - Fonts: Instrument Sans stack for UI/headings, Instrument Serif for a few editorial emphasis words, Space Mono only for hashes and addresses.
  - Colors: warm off-white `#F5F5F3`, deep teal `#0A4454`, sky blue `#7FC5F6`, yellow `#F9C933`, pink `#F061B7`, orange `#F4A548`, green `#53D36A`, black `#111111`, white.
  - Surfaces: flat color blocks with thick black outlines. No glass, no inset glow, no complex shadows.
  - Radius: 20px to 32px for main panels and pills.
  - Gradients are not allowed.
- App illustrations should be flat editorial storybook style with thick hand-drawn black outlines, solid fills, no shading, no texture, and no fake UI data.
- Editorial does not mean oversized or wasteful. Protected app screens must use compact, work-focused density: restrained headings, tighter cards, slimmer sidebars, and icons sized for hierarchy rather than spectacle.
- Dashboard desktop layout must fit the primary overview in the first viewport. Do not force users to scroll just to see the dashboard's main panel.
- Dashboard must not duplicate sidebar navigation with extra route cards unless the user explicitly asks for that layout. Account setup/funding belongs on `/account`, payment authorization belongs on `/transfer`, and event history belongs on `/activity`.
- Do not place decorative or redundant icons on dashboard cards. Icons must serve navigation, commands, wallet identity, or critical state only.
- Dashboard and protected route surfaces should not use loud colored card fills. Use warm off-white, white, pale blue, and compact teal typography; reserve yellow/pink/orange/green for small accents or status chips.
- Dashboard, account, transfer, and activity cards should use light dividers and subtle surface changes rather than thick black outlines everywhere. Keep black outlines for buttons, wallet gates, critical warnings, or intentionally emphasized controls.
- Protected app badges, routine icons, form fields, account rows, readiness rows, transfer payload rows, and activity items must not reuse the saturated landing palette as their default container treatment. Use neutral surfaces by default and only tint actual success/warning/error states softly.
- Do not show a custom StelaKey logo mark in the app UI unless the user explicitly approves a new one.
- Sidebar navigation should be text-first and compact. Do not add route icons unless they solve a real scan/recognition problem.
- Protected app routes are a desktop experience. On mobile/tablet widths, blur the app behind a clear full-screen message instead of trying to squeeze account and transfer workflows into an unreliable small-screen layout.
- Do not use lucide-react icons. Use `@hugeicons/react` with `@hugeicons/core-free-icons` inside CSS-shaped containers.
- Icon elements must not render visible text letters such as `D`, `A`, `T`, `L`, `W`, `P`, or `K` as icons.
- Use large Hugeicons only for true gate, empty, or critical state surfaces. Do not put oversized decorative icons in routine form/card headers where they consume workflow space.
- Visible app branding must say `StelaKey` with no trailing period. Do not show a brand icon beside the app name in the landing nav, wallet gate, or protected app sidebar unless the user explicitly approves a new mark.
- Use official-style Bitcoin and Stellar brand marks for the product identity and cross-chain context. Do not use abstract placeholder marks where the user expects Bitcoin/Stellar logos.
- Landing illustration must include the official Stellar logo form where Stellar is represented. Do not substitute a generic star/sparkle mark or SVG placeholder for Stellar.
- Protected transfer UI must make the ZK completion condition explicit: account existence is not ZK success; ZK success requires a generated proof from the signed wallet challenge and a confirmed Stellar transaction for the final payment.
- Avoid extra decorative gradients, blobs, or unrelated dark/vibe-coded styles.
- Use restrained, work-focused app UI. This is a financial/security product, not a decorative landing experiment.
- Landing page can be expressive, but it must still use real product content and must not expose protected workflows.
- Text must fit its container on mobile and desktop. Hashes, contract IDs, addresses, buttons, and headings must wrap or clamp cleanly without overflow.
- App text contrast must be readable on pale blue, white, and skeleton surfaces; muted text may not be so light that account/status content becomes hard to read.
- Primary black buttons must always render white text and white icon strokes in normal, loading, disabled, and `asChild` link states. Secondary and outline buttons must never place black text on a black surface.

## Live State Rules

Allowed only in isolated tests that are never shown as product behavior:

- unit-test doubles
- local-only contract tests
- compiler artifacts that are not presented as user state

Never allowed:

- fake proof success
- fake transaction hashes
- fake explorer links
- hardcoded successful deploy states
- hardcoded successful transfer states
- mock balances shown as testnet balances
- local-only behavior described as deployed testnet behavior
- fixture-created contracts, hashes, explorer links, balances, proofs, or activity presented as product/user state
- fixture/demo/test-wallet live actions without same-turn explicit user approval
- simulation/no-send results presented as product success

## Acceptance Criteria

- Visitor opening `/` sees only public product overview and app entry.
- Visitor opening `/dashboard`, `/account`, `/transfer`, or `/activity` sees only a wallet gate and no protected app shell content.
- Connected user sees sidebar with wallet identity and disconnect controls across app routes.
- Transfer page cannot request proof without a signed challenge.
- Proof rejection cannot show success.
- No page shows a testnet transaction hash unless it came from a real relayer response.
- Unknown or pending account/service data renders as loading/checking copy, not unavailable/error copy.
- App uses shadcn/ui foundation while following the supplied blue/white Instrument visual system.
- Web UI imports no `lucide-react` components.
- Build and typecheck pass after every route/UI change.

## Implementation Order

1. Install/configure shadcn/ui for the existing Next app.
2. Replace custom buttons/cards/inputs/sidebar with shadcn/ui components.
3. Keep route permissions from this PRD.
4. Wire wallet session storage and route gate.
5. Implement real challenge/sign/proof flow.
6. Implement real account preview/deploy.
7. Implement real transfer `prepare-auth`.
8. Implement real transfer submission.
9. Add activity log from real service data.

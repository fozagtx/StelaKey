import Link from "next/link";
import { StelaKeyMark } from "@/components/brand-logo";
import { LandingWalletActions } from "@/components/landing-wallet-actions";

const steps = [
  {
    title: "Connect your Bitcoin wallet",
    body: "Start with the wallet you already use. StelaKey keeps the entry point familiar.",
    image: "/illustrations/stelakey-step-connect-cutout.png",
    alt: "A hand-drawn Bitcoin wallet held in one hand"
  },
  {
    title: "Create a Stellar account",
    body: "Your Bitcoin public key maps to a Stellar smart account, without a new seed phrase.",
    image: "/illustrations/stelakey-step-account-cutout.png",
    alt: "A hand-drawn person opening a Stellar doorway"
  },
  {
    title: "Authorize payments",
    body: "Approve the exact action, then StelaKey lets the account act only when authorization checks pass.",
    image: "/illustrations/stelakey-step-authorize-cutout.png",
    alt: "A hand-drawn approval scene between a Bitcoin wallet and Stellar doorway"
  }
];

export default function LandingPage() {
  return (
    <main className="storybook-landing">
      <section className="landing-hero" aria-label="StelaKey">
        <nav className="landing-nav" aria-label="StelaKey home">
          <Link className="landing-brand" href="/">
            <StelaKeyMark size={34} />
            StelaKey
          </Link>
        </nav>

        <div className="landing-hero-grid">
          <div className="landing-copy-content">
            <p className="landing-kicker">One wallet, two worlds</p>
            <h1 className="landing-title">
              Bring your
              <em>Bitcoin wallet</em>
              to Stellar.
            </h1>
            <p>
              Connect the wallet you already trust, open a Stellar account, and move into payments without carrying another seed phrase.
            </p>
            <LandingWalletActions />
          </div>

          <figure className="landing-hero-art" aria-label="Bitcoin wallet opening a Stellar account">
            <img
              alt="A hand-drawn person carrying a Bitcoin wallet toward a Stellar account doorway"
              src="/illustrations/stelakey-hero-cutout.png"
            />
          </figure>
        </div>
      </section>

      <section className="how-section" id="how-it-works" aria-labelledby="how-title">
        <div className="section-heading">
          <p className="landing-kicker">How it works</p>
          <h2 id="how-title">Sign with Bitcoin. Use Stellar.</h2>
          <p>
            StelaKey turns a wallet signature into permission for one exact Stellar action. Nothing moves until the account accepts that authorization.
          </p>
        </div>

        <div className="how-story">
          <div className="how-story-copy">
            <p className="landing-kicker">One action at a time</p>
            <h3>Every payment starts as a clear wallet approval.</h3>
            <p>
              The app prepares the Stellar action first. Your Bitcoin wallet signs that exact action, then the account only moves when the authorization checks pass.
            </p>
          </div>
          <img
            className="how-illustration"
            alt="Three hand-drawn moments showing a Bitcoin wallet connection, a signed authorization, and a Stellar account opening"
            src="/illustrations/stelakey-how-it-works-cutout.png"
          />
        </div>

        <div className="how-steps">
          {steps.map((step) => (
            <article key={step.title}>
              <img src={step.image} alt={step.alt} />
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="footer-cta" aria-labelledby="footer-cta-title">
        <div>
          <p className="landing-kicker">Ready when your wallet is</p>
          <h2 id="footer-cta-title">Open a Stellar account from Bitcoin.</h2>
          <p>Connect a wallet, create the account, then move through the real authorization flow inside the app.</p>
          <Link className="footer-cta-link" href="/dashboard">Launch app</Link>
        </div>
        <img
          alt="A hand-drawn path from a wallet toward a Stellar doorway"
          src="/illustrations/stelakey-footer-path-cutout.png"
        />
      </section>

      <footer className="site-footer">
        <div>
          <Link className="landing-brand" href="/">
            <StelaKeyMark size={34} />
            StelaKey
          </Link>
          <p>Bitcoin wallet access for Stellar smart accounts.</p>
        </div>
        <nav aria-label="Footer">
          <a href="#how-it-works">How it works</a>
          <Link href="/dashboard">Launch app</Link>
          <a href="https://developers.stellar.org/docs/build/apps/zk" rel="noreferrer" target="_blank">Stellar ZK docs</a>
          <a href="https://stellar.org" rel="noreferrer" target="_blank">Stellar</a>
        </nav>
        <div className="footer-small">
          <span>Testnet MVP</span>
          <span>Privacy</span>
          <span>Terms</span>
        </div>
      </footer>
    </main>
  );
}

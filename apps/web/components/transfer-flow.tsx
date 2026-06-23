"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProductIcon } from "./product-icon";
import { StatusToast } from "./status-toast";
import { compact, useWalletSession } from "./wallet-session";

type Challenge = {
  challengeId: string;
  message: string;
  nonce: string;
  expiresAt: string;
  expiryLedger: number;
  replayKey: string;
  messageHash: string;
  stellarIntentHash: string;
  signaturePayloadHash: string;
  networkHash: string;
};

type AuthPayload = {
  accountContractId: string;
  authEntryXdr: string;
  authEntryIndex: number;
  unsignedTransactionXdr: string;
  preparedTransactionXdr: string;
  stellarIntentHash: string;
  signaturePayloadHash: string;
  networkHash: string;
  expiryLedger: number;
  operationHash: string;
  tokenContractId: string;
  amountStroops: string;
};

type Activity = {
  label: string;
  detail: string;
  tone?: "good" | "bad" | "warn";
};

type AccountStatus = {
  ok: boolean;
  ready: boolean;
  network?: string;
  ownerCommitment?: string;
  accountContractId?: string;
  accountDeployed?: boolean;
  accountLookupError?: string;
  xlmBalance?: string;
  xlmBalanceStroops?: string;
  xlmBalanceError?: string;
};

type ProofResult = {
  proofId: string;
  status: "ready" | "rejected";
  ownerCommitment?: string;
  proofBytes?: string;
  publicInputs?: string;
  expiresAt?: string;
  errorCode?: string;
  message?: string;
};

type SubmitResult = {
  status: "submitted" | "rejected";
  txHash?: string;
  explorerUrl?: string;
  errorCode?: string;
  message?: string;
};

const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL;

function transferApi(path: string) {
  if (!RELAYER_URL) return path;
  return `${RELAYER_URL.replace(/\/$/, "")}${path}`;
}

function nowLabel() {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date());
}

function decimalToStroopsOrNull(value: string) {
  const match = /^(\d+)(?:\.(\d{0,7}))?$/.exec(value.trim());
  if (!match?.[1]) return null;
  return BigInt(match[1]) * 10_000_000n + BigInt((match[2] ?? "").padEnd(7, "0"));
}

function positiveStroopsOrNull(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

function cleanServiceMessage(value: unknown) {
  if (typeof value !== "string") return "";
  const message = value.trim();
  if (!message) return "";
  if (/[A-Z0-9_]{3,}/.test(message)) return "";
  if (/command|stack|trace|binary|preflight/i.test(message)) return "";
  return message;
}

function paymentPrepareMessage(code: string, serverMessage: unknown) {
  const clean = cleanServiceMessage(serverMessage);
  if (clean) return `${clean} Nothing was signed.`;
  if (code === "INVALID_STELLAR_ADDRESS") {
    return "Enter a valid Stellar recipient before preparing the payment. Nothing was signed.";
  }
  if (code === "RELAYER_NOT_CONFIGURED") {
    return "Payment preparation is not available right now. Nothing was signed.";
  }
  return "Payment could not be prepared. Check the recipient, amount, asset, and account funding. Nothing was signed.";
}

function authorizationMessage(code: string, serverMessage: unknown) {
  const clean = cleanServiceMessage(serverMessage);
  if (clean) return clean;
  if (code === "INVALID_SIGNATURE") return "The wallet signature did not match this payment. No transaction was submitted.";
  if (code === "PROVER_NOT_CONFIGURED") return "Authorization is not available right now. No transaction was submitted.";
  return "Authorization could not be completed. No transaction was submitted.";
}

function submitMessage(code: string, serverMessage: unknown) {
  const clean = cleanServiceMessage(serverMessage);
  if (clean) return clean;
  if (code === "TRANSFER_CONFIRMATION_TIMEOUT") {
    return "Stellar accepted the payment request, but confirmation timed out. Check the account activity before trying again.";
  }
  return "Payment was not submitted successfully. No confirmed transaction hash is available.";
}

export function TransferFlow() {
  const { wallet, signMessage } = useWalletSession();
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("1");
  const [assetCode, setAssetCode] = useState("XLM");
  const [assetIssuer, setAssetIssuer] = useState("");
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [authPayload, setAuthPayload] = useState<AuthPayload | null>(null);
  const [signature, setSignature] = useState("");
  const [proof, setProof] = useState<ProofResult | null>(null);
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [activity, setActivity] = useState<Activity[]>([
    { label: "Waiting", detail: "Create an account, enter a recipient, then prepare the payment.", tone: "warn" }
  ]);

  const accountContractId = useMemo(() => {
    if (!accountStatus?.accountDeployed) return null;
    return accountStatus.accountContractId ?? null;
  }, [accountStatus]);
  const normalizedAssetCode = assetCode.trim().toUpperCase();
  const accountXlmBalance = accountStatus?.xlmBalance
    ? `${accountStatus.xlmBalance} XLM`
    : accountStatus?.xlmBalanceError
      ? "Could not load balance"
      : accountContractId
        ? "Loading balance"
        : "Create account first";
  const balanceStroops = positiveStroopsOrNull(accountStatus?.xlmBalanceStroops);
  const requestedStroops = decimalToStroopsOrNull(amount);
  const amountInvalid = requestedStroops === null || requestedStroops <= 0n;
  const assetCodeInvalid = !/^[A-Z0-9]{1,12}$/.test(normalizedAssetCode);
  const assetIssuerRequired = normalizedAssetCode !== "XLM" && assetIssuer.trim().length === 0;
  const proofReady =
    proof?.status === "ready" && Boolean(proof.proofBytes && proof.publicInputs && proof.ownerCommitment);
  const xlmBalanceTooLow =
    Boolean(accountContractId) &&
    normalizedAssetCode === "XLM" &&
    balanceStroops !== null &&
    requestedStroops !== null &&
    balanceStroops < requestedStroops;

  useEffect(() => {
    let active = true;
    setAccountStatus(null);
    setChallenge(null);
    setAuthPayload(null);
    setSignature("");
    setProof(null);
    setSubmitted(null);

    async function loadAccountStatus() {
      if (!wallet) return;
      try {
        const response = await fetch(`/api/accounts/deploy?btcPubKey=${encodeURIComponent(wallet.publicKey)}`, {
          cache: "no-store"
        });
        const status = (await response.json()) as AccountStatus;
        if (!active) return;
        setAccountStatus(status);
        if (status.accountLookupError) {
          pushActivity({ label: "Account lookup failed", detail: status.accountLookupError, tone: "bad" });
        } else if (!status.accountDeployed) {
          pushActivity({ label: "Account required", detail: "Create your Stellar account before preparing payment.", tone: "warn" });
        } else if (status.accountContractId) {
          pushActivity({ label: "Account found", detail: compact(status.accountContractId, 12, 10), tone: "good" });
        }
      } catch {
        if (!active) return;
        setAccountStatus(null);
        pushActivity({ label: "Account lookup failed", detail: "Account service is unreachable.", tone: "bad" });
      }
    }

    void loadAccountStatus();

    return () => {
      active = false;
    };
  }, [wallet]);

  function pushActivity(item: Activity) {
    setActivity((items) => [{ ...item, label: `${nowLabel()} ${item.label}` }, ...items].slice(0, 8));
  }

  function clearPreparedPayment() {
    setChallenge(null);
    setAuthPayload(null);
    setSignature("");
    setProof(null);
    setSubmitted(null);
  }

  function updateDestination(value: string) {
    if (value !== destination) clearPreparedPayment();
    setDestination(value);
  }

  function updateAmount(value: string) {
    if (value !== amount) clearPreparedPayment();
    setAmount(value);
  }

  function updateAssetCode(value: string) {
    const next = value.toUpperCase();
    if (next !== assetCode) clearPreparedPayment();
    setAssetCode(next);
  }

  function updateAssetIssuer(value: string) {
    if (value !== assetIssuer) clearPreparedPayment();
    setAssetIssuer(value);
  }

  async function requestChallenge() {
    setNotice("");
    setBusy("challenge");
    try {
      if (!wallet) throw new Error("Connect a wallet first.");
      if (!accountContractId) throw new Error("Create your Stellar account before preparing a payment.");
      if (!destination) throw new Error("Enter a Stellar recipient first.");

      const normalizedAsset = normalizedAssetCode;
      if (assetCodeInvalid) {
        throw new Error("Enter a valid Stellar asset code before preparing the payment.");
      }
      if (amountInvalid) {
        throw new Error("Enter a positive amount with up to 7 decimal places before preparing the payment.");
      }
      if (assetIssuerRequired) {
        throw new Error("Enter the issuer account for this Stellar asset before preparing the payment.");
      }
      if (xlmBalanceTooLow) {
        throw new Error("Fund your StelaKey account with testnet XLM before preparing this payment.");
      }

      const prepareResponse = await fetch(transferApi("/api/transfers/prepare-auth"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountContractId,
          btcAddress: wallet.address,
          destination,
          amount,
          assetCode: normalizedAsset,
          ...(normalizedAsset !== "XLM" ? { assetIssuer } : {}),
          stellarNetwork: "testnet"
        })
      });
      const prepared = await prepareResponse.json().catch(() => ({}));
      if (!prepareResponse.ok) {
        const code = typeof prepared.errorCode === "string" ? prepared.errorCode : `HTTP_${prepareResponse.status}`;
        throw new Error(paymentPrepareMessage(code, prepared.message));
      }

      const payload = prepared as AuthPayload;
      setAuthPayload(payload);
      setProof(null);
      setSubmitted(null);
      const response = await fetch("/api/challenges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          btcAddress: wallet.address,
          btcPubKey: wallet.publicKey,
          walletProvider: wallet.provider,
          purpose: "transfer",
          stellarNetwork: "testnet",
          stellarIntentHash: payload.stellarIntentHash,
          signaturePayloadHash: payload.signaturePayloadHash,
          networkHash: payload.networkHash,
          expiryLedger: payload.expiryLedger
        })
      });
      if (!response.ok) throw new Error(`Challenge service returned HTTP ${response.status}.`);
      const body = (await response.json()) as Challenge;
      setChallenge(body);
      setSignature("");
      pushActivity({
        label: "Ready to sign",
        detail: `Authorization ${compact(body.messageHash, 10, 8)}`,
        tone: "good"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authorization failed.";
      setNotice(message);
      pushActivity({ label: "Authorization stopped", detail: message, tone: "bad" });
    } finally {
      setBusy(null);
    }
  }

  async function signChallenge() {
    setNotice("");
    setBusy("signature");
    try {
      if (!challenge) throw new Error("Prepare the payment first.");
      const signed = await signMessage(challenge.message);
      setSignature(signed);
      pushActivity({ label: "Signed", detail: compact(signed, 10, 8), tone: "good" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Signature failed.";
      setNotice(message);
      pushActivity({ label: "Signature failed", detail: message, tone: "bad" });
    } finally {
      setBusy(null);
    }
  }

  async function generateProof() {
    setNotice("");
    setBusy("proof");
    try {
      if (!wallet || !challenge || !signature) throw new Error("Sign the payment first.");
      const response = await fetch("/api/proofs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          btcAddress: wallet.address,
          btcPubKey: wallet.publicKey,
          signature,
          signatureScheme: "ecdsa-message"
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.status === "rejected") {
        const code = typeof body.errorCode === "string" ? body.errorCode : `HTTP_${response.status}`;
        throw new Error(authorizationMessage(code, body.message));
      }
      const nextProof = body as ProofResult;
      if (nextProof.status !== "ready" || !nextProof.proofBytes || !nextProof.publicInputs || !nextProof.ownerCommitment) {
        throw new Error("Authorization did not return complete proof data. No transaction was submitted.");
      }
      setProof(nextProof);
      pushActivity({ label: "Authorized", detail: `Proof ${compact(nextProof.proofId, 10, 8)} is ready.`, tone: "good" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authorization failed.";
      setNotice(message);
      pushActivity({ label: "Authorization stopped", detail: message, tone: "bad" });
    } finally {
      setBusy(null);
    }
  }

  async function submitPayment() {
    setNotice("");
    setBusy("submit");
    try {
      if (!authPayload || !proof) throw new Error("Authorize the payment first.");
      if (!proofReady) {
        throw new Error("Authorization did not return complete proof data. No transaction was submitted.");
      }
      const response = await fetch(transferApi("/api/transfers/submit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountContractId: authPayload.accountContractId,
          preparedTransactionXdr: authPayload.preparedTransactionXdr,
          authEntryIndex: authPayload.authEntryIndex,
          authEntryXdr: authPayload.authEntryXdr,
          signaturePayloadHash: authPayload.signaturePayloadHash,
          expiryLedger: authPayload.expiryLedger,
          proofBytes: proof.proofBytes,
          publicInputs: proof.publicInputs,
          ownerCommitment: proof.ownerCommitment
        })
      });
      const body = (await response.json().catch(() => ({}))) as SubmitResult;
      if (!response.ok || body.status === "rejected") {
        const code = typeof body.errorCode === "string" ? body.errorCode : `HTTP_${response.status}`;
        throw new Error(submitMessage(code, body.message));
      }
      if (body.status !== "submitted" || !body.txHash) {
        throw new Error("Payment submission did not return a confirmed transaction hash. No success was recorded.");
      }
      setSubmitted(body);
      pushActivity({
        label: "Payment sent",
        detail: compact(body.txHash, 12, 10),
        tone: "good"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payment submit failed.";
      setNotice(message);
      pushActivity({ label: "Payment stopped", detail: message, tone: "bad" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="route-grid transfer-grid">
      <StatusToast
        title="Payment update"
        message={notice}
        tone="error"
        onDismiss={() => setNotice("")}
      />
      <Card className="transfer-card">
        <CardHeader className="compact-card-header">
          <Badge variant="outline" className="soft-badge">Transfer</Badge>
          <CardTitle>Authorize a Stellar payment</CardTitle>
        </CardHeader>
        <CardContent className="compact-card-content">
        <div className="intent-strip">
          <span>Stellar account</span>
          <strong>{accountContractId ? compact(accountContractId, 14, 10) : "Create account first"}</strong>
        </div>
        <div className="intent-strip">
          <span>XLM balance</span>
          <strong>{accountXlmBalance}</strong>
        </div>
        <Label>
          Recipient
          <Input value={destination} onChange={(event) => updateDestination(event.target.value)} placeholder="G..." />
        </Label>
        <div className="split">
          <Label>
            Amount
            <Input value={amount} onChange={(event) => updateAmount(event.target.value)} />
          </Label>
          <Label>
            Asset
            <Input value={assetCode} onChange={(event) => updateAssetCode(event.target.value)} />
          </Label>
        </div>
        {normalizedAssetCode !== "XLM" ? (
          <Label className="issuer-field">
            Asset issuer
            <Input value={assetIssuer} onChange={(event) => updateAssetIssuer(event.target.value)} placeholder="G..." />
          </Label>
        ) : null}
        <div className="intent-strip">
          <span>Authorization payload</span>
          <strong>{authPayload ? compact(authPayload.signaturePayloadHash, 12, 10) : "Prepare first"}</strong>
        </div>
        <div className="intent-strip">
          <span>Payment submission</span>
          <strong>
            {submitted?.txHash
              ? compact(submitted.txHash, 12, 10)
              : proof?.status === "ready"
                ? "Ready to submit"
                : "Not submitted"}
          </strong>
        </div>
        <div className="proof-status">
          <div>
            <span>Account</span>
            <strong>
              {accountContractId
                ? xlmBalanceTooLow
                  ? "Fund account first"
                  : "Existing account ready"
                : "Account required"}
            </strong>
          </div>
          <div>
            <span>Wallet signature</span>
            <strong>{signature ? "Signed current payment" : "Not signed"}</strong>
          </div>
          <div>
            <span>ZK proof</span>
            <strong>{proofReady ? `Generated ${compact(proof.proofId, 10, 8)}` : "Not generated"}</strong>
          </div>
          <div>
            <span>Stellar result</span>
            <strong>{submitted?.txHash ? `Confirmed ${compact(submitted.txHash, 10, 8)}` : "Not confirmed"}</strong>
          </div>
        </div>
        <div className="button-row spacious">
          <Button
            onClick={requestChallenge}
            disabled={
              !accountContractId ||
              xlmBalanceTooLow ||
              amountInvalid ||
              assetCodeInvalid ||
              assetIssuerRequired ||
              busy === "challenge"
            }
          >
            <span className="button-symbol" aria-hidden="true">
              <ProductIcon name="payment" size={19} strokeWidth={2} />
            </span>
            {busy === "challenge" ? "Preparing..." : "Prepare"}
          </Button>
          {xlmBalanceTooLow ? (
            <Button asChild variant="outline">
              <a href="/account">
                <ProductIcon name="payment" size={19} strokeWidth={2} />
                Fund account
              </a>
            </Button>
          ) : null}
          <Button onClick={signChallenge} disabled={!challenge || busy === "signature"} variant="secondary">
            <span className="button-symbol" aria-hidden="true">
              <ProductIcon name="wallet" size={19} strokeWidth={2} />
            </span>
            {busy === "signature" ? "Signing..." : "Sign"}
          </Button>
          <Button onClick={generateProof} disabled={!signature || busy === "proof"} variant="outline">
            <span className="button-symbol" aria-hidden="true">
              <ProductIcon name="authorize" size={19} strokeWidth={2} />
            </span>
            {busy === "proof" ? "Authorizing..." : "Authorize"}
          </Button>
          <Button onClick={submitPayment} disabled={!proofReady || busy === "submit"} variant="secondary">
            <span className="button-symbol" aria-hidden="true">
              <ProductIcon name="transfer" size={19} strokeWidth={2} />
            </span>
            {busy === "submit" ? "Submitting..." : "Submit payment"}
          </Button>
        </div>
        {submitted?.explorerUrl ? (
          <Button asChild variant="outline" className="account-cta transfer-link">
            <a href={submitted.explorerUrl} target="_blank" rel="noreferrer">
              <ProductIcon name="link" size={20} />
              View transaction
            </a>
          </Button>
        ) : null}
        </CardContent>
      </Card>

      <Card className="status-card">
        <CardHeader className="compact-card-header">
          <Badge variant="outline" className="soft-badge">Status</Badge>
          <CardTitle>Payment status</CardTitle>
        </CardHeader>
        <CardContent className="compact-card-content">
        <ul className="activity-list">
          {activity.map((item, index) => (
            <li key={`${item.label}-${index}`} className={item.tone}>
              <span>{item.label}</span>
              <p>{item.detail}</p>
            </li>
          ))}
        </ul>
        </CardContent>
      </Card>
    </div>
  );
}

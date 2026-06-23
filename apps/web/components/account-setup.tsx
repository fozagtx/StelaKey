"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductIcon } from "./product-icon";
import { StatusToast } from "./status-toast";
import { compact, useWalletSession } from "./wallet-session";

type AccountStatus = {
  ok: boolean;
  ready: boolean;
  missing?: string[];
  network?: string;
  deployerContractId?: string;
  verifierContractId?: string;
  ownerCommitment?: string;
  accountContractId?: string;
  accountDeployed?: boolean;
  accountLookupError?: string;
  xlmBalance?: string;
  xlmBalanceStroops?: string;
  xlmBalanceError?: string;
};

type DeploySuccess = {
  ok: true;
  existing?: boolean;
  accountContractId: string;
  txHash?: string;
  explorerUrl?: string;
  ownerCommitment: string;
  network: string;
  xlmBalance?: string;
  xlmBalanceStroops?: string;
  xlmBalanceError?: string;
};

type DeployFailure = {
  ok: false;
  error: string;
  message: string;
};

type FundSuccess = {
  ok: true;
  status: "funded";
  accountContractId: string;
  amount: string;
  amountStroops: string;
  xlmBalance: string;
  xlmBalanceStroops: string;
  txHash: string;
  explorerUrl: string;
};

type FundFailure = {
  ok: false;
  errorCode: string;
  message: string;
};

function balanceFields(input: {
  xlmBalance?: string;
  xlmBalanceStroops?: string;
  xlmBalanceError?: string;
}) {
  return {
    ...(input.xlmBalance !== undefined ? { xlmBalance: input.xlmBalance } : {}),
    ...(input.xlmBalanceStroops !== undefined ? { xlmBalanceStroops: input.xlmBalanceStroops } : {}),
    ...(input.xlmBalanceError !== undefined ? { xlmBalanceError: input.xlmBalanceError } : {})
  };
}

export function AccountSetup() {
  const { wallet, disconnect } = useWalletSession();
  const router = useRouter();
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [account, setAccount] = useState<DeploySuccess | null>(null);
  const [funded, setFunded] = useState<FundSuccess | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fundingBusy, setFundingBusy] = useState(false);
  const [copiedAccount, setCopiedAccount] = useState(false);
  const [message, setMessage] = useState("");

  const statusUrl = useMemo(() => {
    if (!wallet) return "/api/accounts/deploy";
    return `/api/accounts/deploy?btcPubKey=${encodeURIComponent(wallet.publicKey)}`;
  }, [wallet]);

  useEffect(() => {
    let active = true;
    setStatusLoading(true);
    setStatus(null);
    setAccount(null);
    setFunded(null);
    setCopiedAccount(false);
    setMessage("");

    async function loadStatus() {
      try {
        const response = await fetch(statusUrl, { cache: "no-store" });
        const nextStatus = (await response.json()) as AccountStatus;
        if (!active) return;
        setStatus(nextStatus);
        if (nextStatus.accountDeployed && nextStatus.accountContractId && nextStatus.ownerCommitment) {
          setAccount({
            ok: true,
            existing: true,
            accountContractId: nextStatus.accountContractId,
            ownerCommitment: nextStatus.ownerCommitment,
            network: nextStatus.network ?? "testnet",
            ...balanceFields(nextStatus)
          });
        } else {
          setAccount(null);
        }
      } catch {
        if (active) {
          setStatus(null);
          setMessage("Account setup service is unreachable.");
        }
      } finally {
        if (active) {
          setStatusLoading(false);
        }
      }
    }

    void loadStatus();

    return () => {
      active = false;
    };
  }, [statusUrl]);

  async function createAccount() {
    if (!wallet || !status?.ready) return;
    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/accounts/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          btcAddress: wallet.address,
          btcPubKey: wallet.publicKey,
          provider: wallet.provider,
          bitcoinNetwork: wallet.network
        })
      });
      const result = (await response.json()) as DeploySuccess | DeployFailure;
      if (!response.ok || !result.ok) {
        setMessage(result.ok ? "Account setup failed." : result.message);
        return;
      }
      setAccount(result);
      setStatus((current) =>
        current
          ? {
              ...current,
              accountContractId: result.accountContractId,
              accountDeployed: true,
              ownerCommitment: result.ownerCommitment,
              ...balanceFields(result)
            }
          : current
      );
    } catch {
      setMessage("Account setup failed before Stellar confirmed a contract.");
    } finally {
      setBusy(false);
    }
  }

  async function fundAccount() {
    const accountContractId = account?.accountContractId ?? status?.accountContractId;
    if (!wallet || !accountContractId) return;
    setFundingBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/accounts/fund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountContractId,
          btcPubKey: wallet.publicKey,
          amount: "10"
        })
      });
      const result = (await response.json().catch(() => ({}))) as FundSuccess | FundFailure;
      if (!response.ok || !result.ok) {
        setMessage(result.ok ? "Account funding failed." : result.message);
        return;
      }
      setFunded(result);
      setStatus((current) => {
        if (!current) return current;
        const { xlmBalanceError: _xlmBalanceError, ...rest } = current;
        return { ...rest, xlmBalance: result.xlmBalance, xlmBalanceStroops: result.xlmBalanceStroops };
      });
      setAccount((current) => {
        if (!current) return current;
        const { xlmBalanceError: _xlmBalanceError, ...rest } = current;
        return { ...rest, xlmBalance: result.xlmBalance, xlmBalanceStroops: result.xlmBalanceStroops };
      });
    } catch {
      setMessage("Account funding failed before Stellar confirmed a transaction.");
    } finally {
      setFundingBusy(false);
    }
  }

  async function copyAccountAddress() {
    if (!accountContractId) return;
    try {
      await navigator.clipboard.writeText(accountContractId);
      setCopiedAccount(true);
      window.setTimeout(() => setCopiedAccount(false), 1800);
    } catch {
      setMessage("Could not copy the account address from this browser.");
    }
  }

  function switchWallet() {
    disconnect();
    setAccount(null);
    setStatus(null);
    setFunded(null);
    setMessage("");
    router.push("/");
  }

  const canCreate = Boolean(wallet && status?.ready && !account && !statusLoading && !busy);
  const accountContractId = account?.accountContractId ?? status?.accountContractId;
  const displayedBalance = statusLoading
    ? "Loading..."
    : accountContractId
      ? account?.xlmBalance ?? status?.xlmBalance ?? (status?.xlmBalanceError ? "Could not load balance" : "0.0000000")
      : "Create account first";
  const displayedBalanceLabel =
    displayedBalance === "Loading..." ||
    displayedBalance === "Create account first" ||
    displayedBalance === "Could not load balance"
      ? displayedBalance
      : `${displayedBalance} XLM`;
  const providerLabel = wallet?.provider
    ? wallet.provider.slice(0, 1).toUpperCase() + wallet.provider.slice(1)
    : "Bitcoin";
  const accountTitle = busy
    ? "Setting up account"
    : accountContractId
      ? "StelaKey account"
      : statusLoading
        ? "Checking account"
        : status?.ready
          ? "Create StelaKey account"
          : "Setup unavailable";
  const accountState = accountContractId
    ? account?.existing
      ? "Existing account found"
      : account?.explorerUrl
        ? "Setup transaction confirmed"
        : "Account ready"
    : statusLoading
      ? "Checking on Stellar testnet"
      : status?.ready
        ? "Ready to create on Stellar testnet"
        : "Account setup service is unavailable";
  const accountReadyLabel = accountContractId ? "Ready" : statusLoading ? "Checking" : "Not created";
  const balanceReadyLabel = accountContractId
    ? statusLoading
      ? "Checking"
      : status?.xlmBalanceError
        ? "Needs refresh"
        : "Loaded"
    : "After setup";

  return (
    <section className="account-layout">
      <StatusToast
        title="Account update"
        message={message}
        tone="error"
        onDismiss={() => setMessage("")}
      />
      <Card className="account-viewer-card">
        <CardHeader className="account-viewer-header">
          <span className="soft-icon soft-icon-lg" aria-hidden="true">
            <ProductIcon name="account" size={50} />
          </span>
          <div>
            <CardTitle>{accountTitle}</CardTitle>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={switchWallet}>
            <ProductIcon name="wallet" size={18} />
            Switch wallet
          </Button>
        </CardHeader>
        <CardContent className="account-viewer-content" aria-busy={busy || statusLoading}>
          <div className="account-profile-card">
            <span className="account-avatar" aria-hidden="true">
              <ProductIcon name="bitcoin" size={42} />
            </span>
            <div className="account-profile-main">
              <span>Connected wallet</span>
              <strong>{wallet ? compact(wallet.address, 16, 12) : "Connect wallet"}</strong>
            </div>
            <Badge variant="outline" className="soft-badge">{providerLabel}</Badge>
          </div>

          <div className="account-viewer-rows">
            <div className="account-viewer-row">
              <span>StelaKey account</span>
              {accountContractId ? (
                <div className="copyable-value">
                  <strong>{accountContractId}</strong>
                  <Button type="button" variant="secondary" size="sm" onClick={copyAccountAddress}>
                    <ProductIcon name={copiedAccount ? "ready" : "copy"} size={18} />
                    {copiedAccount ? "Copied" : "Copy"}
                  </Button>
                </div>
              ) : (
                <strong>{statusLoading ? "Checking..." : "Not created"}</strong>
              )}
            </div>
            <div className="account-viewer-row">
              <span>XLM balance</span>
              <strong>{displayedBalanceLabel}</strong>
            </div>
            <div className="account-viewer-row">
              <span>Status</span>
              <strong>{accountState}</strong>
            </div>
          </div>

          <div className="account-action-bar">
            {accountContractId ? (
              <>
                <Button type="button" className="account-cta" onClick={fundAccount} disabled={fundingBusy}>
                  <ProductIcon name="payment" size={22} />
                  {fundingBusy ? "Funding..." : "Fund 10 testnet XLM"}
                </Button>
                {account?.explorerUrl ? (
                  <Button asChild variant="secondary" className="account-cta">
                    <a href={account.explorerUrl} target="_blank" rel="noreferrer">
                      <ProductIcon name="link" size={22} />
                      View setup transaction
                    </a>
                  </Button>
                ) : null}
              </>
            ) : statusLoading || status?.ready ? (
              <Button className="account-cta" onClick={createAccount} disabled={!canCreate || busy}>
                <ProductIcon name="account" size={22} />
                {busy ? "Setting up..." : statusLoading ? "Checking account..." : "Create account"}
              </Button>
            ) : null}
            {funded?.explorerUrl ? (
              <Button asChild variant="outline" className="account-cta">
                <a href={funded.explorerUrl} target="_blank" rel="noreferrer">
                  <ProductIcon name="link" size={22} />
                  View funding transaction
                </a>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="account-readiness-card">
        <CardHeader>
          <span className="soft-icon soft-icon-lg" aria-hidden="true">
            <ProductIcon name="security" size={48} />
          </span>
          <Badge variant="outline" className="soft-badge">Readiness</Badge>
          <CardTitle>Payment access</CardTitle>
        </CardHeader>
        <CardContent className="account-readiness-list" aria-busy={statusLoading}>
          <div className="readiness-item good">
            <ProductIcon name="wallet" size={28} />
            <div>
              <span>Wallet</span>
              <strong>Connected</strong>
            </div>
          </div>
          <div className={accountContractId ? "readiness-item good" : "readiness-item"}>
            <ProductIcon name={accountContractId ? "ready" : "account"} size={28} />
            <div>
              <span>Account</span>
              <strong>{accountReadyLabel}</strong>
            </div>
          </div>
          <div className={accountContractId && !status?.xlmBalanceError ? "readiness-item good" : "readiness-item"}>
            <ProductIcon name="payment" size={28} />
            <div>
              <span>Balance</span>
              <strong>{balanceReadyLabel}</strong>
            </div>
          </div>
          <p className="account-help">
            Payments still require a fresh wallet signature, a generated authorization proof, and a confirmed Stellar transaction before any success state appears.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { StelaKeyMark } from "../../components/brand-logo";
import { ProductIcon } from "../../components/product-icon";
import { compact, useWalletSession } from "../../components/wallet-session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type AccountStatus = {
  ok: boolean;
  ready: boolean;
  network?: string;
  accountContractId?: string;
  accountDeployed?: boolean;
  accountLookupError?: string;
  xlmBalance?: string;
  xlmBalanceError?: string;
};

export default function DashboardPage() {
  const { wallet } = useWalletSession();
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setStatus(null);
    setError("");
    setLoading(true);

    async function loadStatus() {
      if (!wallet) return;
      try {
        const response = await fetch(`/api/accounts/deploy?btcPubKey=${encodeURIComponent(wallet.publicKey)}`, {
          cache: "no-store"
        });
        const body = (await response.json()) as AccountStatus;
        if (!active) return;
        setStatus(body);
        setError(body.accountLookupError ?? "");
      } catch {
        if (!active) return;
        setError("Account service is unreachable.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadStatus();
    return () => {
      active = false;
    };
  }, [wallet]);

  const accountContractId = status?.accountDeployed ? status.accountContractId : undefined;
  const accountState = useMemo(() => {
    if (loading) return { label: "Checking account", tone: "loading" };
    if (error) return { label: "Account check failed", tone: "bad" };
    if (accountContractId) return { label: "Account ready", tone: "good" };
    return { label: "Create account", tone: "warn" };
  }, [accountContractId, error, loading]);

  const balanceLabel = loading
    ? "Checking balance"
    : status?.xlmBalance
      ? `${status.xlmBalance} XLM`
      : status?.xlmBalanceError
        ? "Balance unavailable"
        : accountContractId
          ? "Balance loading"
          : "Account required";

  return (
    <AppShell>
      <section className="dashboard-home" aria-labelledby="dashboard-title">
        <Card className="dashboard-hero-card">
          <CardContent className="dashboard-hero-content">
            <div className="dashboard-title-row">
              <StelaKeyMark size={62} />
              <Badge variant="secondary">Testnet workspace</Badge>
            </div>
            <div>
              <h1 id="dashboard-title">Bring your Bitcoin wallet into Stellar.</h1>
              <p>
                Create the Stellar account tied to this wallet, then authorize payments one action at a time.
              </p>
            </div>
            <div className="dashboard-wallet-row">
              <span>Connected wallet</span>
              <strong>{wallet ? compact(wallet.address, 16, 12) : "Wallet loading"}</strong>
            </div>
          </CardContent>
        </Card>

        <div className="dashboard-state-grid">
          <Card className="dashboard-state-card">
            <CardContent className="dashboard-state-content">
              <span className={`state-dot ${accountState.tone}`} aria-hidden="true" />
              <div>
                <span>Stellar account</span>
                <strong>{accountState.label}</strong>
                <p>{accountContractId ? compact(accountContractId, 16, 12) : "Create the account before preparing a payment."}</p>
              </div>
              <Button asChild variant={accountContractId ? "outline" : "default"}>
                <Link href="/account">{accountContractId ? "View account" : "Create account"}</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="dashboard-state-card">
            <CardContent className="dashboard-state-content">
              <span className={`state-dot ${loading ? "loading" : accountContractId ? "good" : "warn"}`} aria-hidden="true" />
              <div>
                <span>XLM balance</span>
                <strong>{balanceLabel}</strong>
                <p>{accountContractId ? "Used for real testnet payment submission." : "Funding opens after account creation."}</p>
              </div>
              <Button asChild variant="outline">
                <Link href="/transfer">Open transfer</Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="dashboard-path-card">
          <CardContent className="dashboard-path-content">
            <div>
              <ProductIcon name="wallet" size={24} />
              <span>Connect</span>
            </div>
            <div>
              <ProductIcon name="account" size={24} />
              <span>Create account</span>
            </div>
            <div>
              <ProductIcon name="authorize" size={24} />
              <span>Authorize</span>
            </div>
            <div>
              <ProductIcon name="transfer" size={24} />
              <span>Submit</span>
            </div>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}

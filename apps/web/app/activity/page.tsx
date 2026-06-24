"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { compact, useWalletSession } from "../../components/wallet-session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  readStelaKeyActivityEvents,
  type StelaKeyActivityEvent
} from "@/lib/activity-events";

type AccountStatus = {
  ok: boolean;
  ready: boolean;
  network?: string;
  accountContractId?: string;
  accountDeployed?: boolean;
  accountLookupError?: string;
};

function eventTitle(event: StelaKeyActivityEvent) {
  if (event.type === "account_created") return "Account created";
  if (event.type === "account_funded") {
    return event.amount ? `Funded ${event.amount} ${event.assetCode ?? "XLM"}` : `Funded ${event.assetCode ?? "XLM"}`;
  }
  return event.amount ? `Sent ${event.amount} ${event.assetCode ?? "XLM"}` : `Sent ${event.assetCode ?? "XLM"}`;
}

function eventDetail(event: StelaKeyActivityEvent) {
  if (event.type === "payment_sent" && event.destination) {
    return `To ${compact(event.destination, 12, 8)}`;
  }
  return compact(event.accountContractId, 16, 10);
}

function eventTime(event: StelaKeyActivityEvent) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(event.createdAt));
}

function EventList({ events }: { events: StelaKeyActivityEvent[] }) {
  return (
    <ul className="activity-list">
      {events.map((event) => (
        <li className="good" key={event.id}>
          <span>{eventTitle(event)}</span>
          <p>{eventDetail(event)}</p>
          <p className="activity-event-meta">
            {eventTime(event)} · {compact(event.txHash, 12, 10)}
          </p>
          {event.explorerUrl ? (
            <a href={event.explorerUrl} rel="noreferrer" target="_blank">
              View on Stellar Expert
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default function ActivityPage() {
  const { wallet } = useWalletSession();
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [events, setEvents] = useState<StelaKeyActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    function refreshEvents(accountContractId?: string) {
      if (!wallet) return;
      setEvents(readStelaKeyActivityEvents({
        walletAddress: wallet.address,
        ...(accountContractId ? { accountContractId } : {})
      }));
    }

    setStatus(null);
    setError("");
    setLoading(true);
    refreshEvents();

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
        if (body.accountDeployed && body.accountContractId) {
          refreshEvents(body.accountContractId);
        }
      } catch {
        if (!active) return;
        setError("Account service is unreachable.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadStatus();

    const refreshOnFocus = () => refreshEvents();
    window.addEventListener("focus", refreshOnFocus);

    return () => {
      active = false;
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [wallet]);

  const accountContractId = status?.accountDeployed ? status.accountContractId : undefined;
  const visibleEvents = useMemo(
    () => events.filter((event) => !accountContractId || event.accountContractId === accountContractId),
    [accountContractId, events]
  );

  return (
    <AppShell>
      <section className="activity-workspace" aria-labelledby="activity-title">
        <Card className="activity-summary-card">
          <CardContent className="activity-summary-content">
            <span className={`state-dot ${loading ? "loading" : error ? "bad" : visibleEvents.length > 0 ? "good" : "warn"}`} aria-hidden="true" />
            <div>
              <Badge variant="outline" className="soft-badge">Activity</Badge>
              <h1 id="activity-title">Confirmed activity only.</h1>
              <p>
                {visibleEvents.length > 0
                  ? `${visibleEvents.length} confirmed event${visibleEvents.length === 1 ? "" : "s"} recorded for this wallet.`
                  : "No account details are shown here until there is a real transaction event to list."}
              </p>
            </div>
            <Button asChild variant={accountContractId ? "default" : "outline"}>
              <Link href={accountContractId ? "/transfer" : "/account"}>
                {accountContractId ? "Prepare transfer" : "Create account"}
              </Link>
            </Button>
          </CardContent>
        </Card>

        {loading ? (
          <Card className="activity-empty-card">
            <CardContent className="activity-empty-content">
              <div className="activity-loading-block">
                <span />
                <span />
                <span />
              </div>
            </CardContent>
          </Card>
        ) : visibleEvents.length > 0 ? (
          <Card className="activity-event-card">
            <CardContent className="compact-card-content activity-ledger-content">
              <EventList events={visibleEvents} />
            </CardContent>
          </Card>
        ) : (
          <Card className="activity-empty-card">
            <CardContent className="activity-empty-content">
              <img
                alt="A hand-drawn empty activity path waiting for the first confirmed Stellar receipt"
                className="activity-empty-art"
                src="/illustrations/stelakey-activity-empty-cutout.png"
              />
              <div className="activity-empty-copy">
                <Badge variant="outline" className="soft-badge">No events</Badge>
                <h2>{error ? "Activity could not load." : "No confirmed activity yet."}</h2>
                <p>
                  {error
                    ? error
                    : accountContractId
                      ? "Your account can stay ready without cluttering this page. After a real payment confirms, the receipt appears here."
                      : "Create your Stellar account first. Confirmed transactions will appear here after they happen."}
                </p>
                <Button asChild>
                  <Link href={accountContractId ? "/transfer" : "/account"}>
                    {accountContractId ? "Start a transfer" : "Create account"}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </AppShell>
  );
}

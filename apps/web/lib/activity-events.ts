export type StelaKeyActivityType = "account_created" | "account_funded" | "payment_sent";

export type StelaKeyActivityEvent = {
  id: string;
  type: StelaKeyActivityType;
  createdAt: string;
  walletAddress: string;
  accountContractId: string;
  txHash: string;
  explorerUrl?: string;
  amount?: string;
  assetCode?: string;
  destination?: string;
};

const ACTIVITY_STORAGE_KEY = "stelakey.activity.v1";

function isActivityEvent(value: unknown): value is StelaKeyActivityEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<StelaKeyActivityEvent>;
  return (
    (event.type === "account_created" || event.type === "account_funded" || event.type === "payment_sent") &&
    typeof event.id === "string" &&
    typeof event.createdAt === "string" &&
    typeof event.walletAddress === "string" &&
    typeof event.accountContractId === "string" &&
    typeof event.txHash === "string"
  );
}

export function readStelaKeyActivityEvents(filters?: {
  walletAddress?: string;
  accountContractId?: string;
}) {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(ACTIVITY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(isActivityEvent)
      .filter((event) => !filters?.walletAddress || event.walletAddress === filters.walletAddress)
      .filter((event) => !filters?.accountContractId || event.accountContractId === filters.accountContractId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

export function recordStelaKeyActivityEvent(event: Omit<StelaKeyActivityEvent, "id" | "createdAt">) {
  if (typeof window === "undefined") return;

  const nextEvent: StelaKeyActivityEvent = {
    ...event,
    id: `${event.type}:${event.txHash}`,
    createdAt: new Date().toISOString()
  };

  const current = readStelaKeyActivityEvents();
  const deduped = current.filter((item) => item.id !== nextEvent.id && item.txHash !== nextEvent.txHash);
  window.localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify([nextEvent, ...deduped].slice(0, 50)));
}

"use client";

import { useEffect } from "react";
import { useWalletSession } from "./wallet-session";

export function WalletNoticeToast() {
  const { notice, clearNotice } = useWalletSession();

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(clearNotice, 5200);
    return () => window.clearTimeout(timer);
  }, [clearNotice, notice]);

  if (!notice) return null;

  return (
    <div className="wallet-toast" role="status" aria-live="polite">
      <div>
        <strong>Wallet connection</strong>
        <p>{notice}</p>
      </div>
      <button type="button" onClick={clearNotice} aria-label="Dismiss wallet notice">
        x
      </button>
    </div>
  );
}

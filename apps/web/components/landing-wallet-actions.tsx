"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { WalletConnectButton } from "./wallet-connect-button";
import { useWalletSession } from "./wallet-session";

export function LandingWalletActions() {
  const { wallet, ready } = useWalletSession();
  const router = useRouter();

  useEffect(() => {
    if (wallet) router.replace("/dashboard");
  }, [router, wallet]);

  if (!ready) return null;
  if (wallet) return null;

  return (
    <div className="landing-actions">
      <WalletConnectButton redirectTo="/dashboard" size="lg" className="landing-connect-button" />
    </div>
  );
}

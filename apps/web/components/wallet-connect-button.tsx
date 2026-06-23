"use client";

import { useRouter } from "next/navigation";
import { BitcoinLogo } from "@/components/brand-logo";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useWalletSession } from "./wallet-session";

type WalletConnectButtonProps = {
  className?: string;
  redirectTo?: string;
  size?: ButtonProps["size"];
};

export function WalletConnectButton({ className, redirectTo, size = "default" }: WalletConnectButtonProps) {
  const { busy, connectWallet } = useWalletSession();
  const router = useRouter();

  async function handleConnect() {
    const connected = await connectWallet();
    if (connected && redirectTo) {
      router.push(redirectTo);
    }
  }

  return (
    <Button size={size} className={className} onClick={handleConnect} disabled={busy}>
      <span className="button-symbol" aria-hidden="true">
        <BitcoinLogo size={19} />
      </span>
      {busy ? "Connecting..." : "Connect Wallet"}
    </Button>
  );
}

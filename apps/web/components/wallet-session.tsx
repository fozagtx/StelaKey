"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import Wallet, {
  AddressPurpose,
  getDefaultProvider,
  MessageSigningProtocols,
  removeDefaultProvider
} from "sats-connect";

export type WalletProviderName = "xverse" | "unisat" | "generic";

export type WalletSession = {
  provider: WalletProviderName;
  address: string;
  publicKey: string;
  network: string;
};

type WalletContextValue = {
  wallet: WalletSession | null;
  ready: boolean;
  busy: boolean;
  notice: string;
  connectWallet: () => Promise<boolean>;
  signMessage: (message: string) => Promise<string>;
  clearNotice: () => void;
  disconnect: () => void;
};

declare global {
  interface Window {
    unisat?: {
      requestAccounts?: () => Promise<string[]>;
      getAccounts: () => Promise<string[]>;
      getPublicKey: () => Promise<string>;
      getNetwork: () => Promise<string>;
      signMessage: (message: string, type?: "ecdsa" | "bip322-simple") => Promise<string>;
    };
  }
}

const WalletContext = createContext<WalletContextValue | null>(null);
const WALLET_STORAGE_KEY = "stelakey.wallet.v1";

function activeWalletProvider(): WalletProviderName {
  const providerId = getDefaultProvider();
  if (providerId === "XverseProviders.BitcoinProvider") return "xverse";
  if (providerId === "unisat") return "unisat";
  return "generic";
}

function readStoredWallet(): WalletSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WALLET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WalletSession>;
    if (
      (parsed.provider === "xverse" || parsed.provider === "unisat" || parsed.provider === "generic") &&
      typeof parsed.address === "string" &&
      parsed.address.length > 0 &&
      typeof parsed.publicKey === "string" &&
      parsed.publicKey.length > 0 &&
      typeof parsed.network === "string" &&
      parsed.network.length > 0
    ) {
      return {
        provider: parsed.provider,
        address: parsed.address,
        publicKey: parsed.publicKey,
        network: parsed.network
      };
    }
  } catch {
    window.localStorage.removeItem(WALLET_STORAGE_KEY);
  }
  return null;
}

function storeWallet(wallet: WalletSession | null) {
  if (typeof window === "undefined") return;
  if (!wallet) {
    window.localStorage.removeItem(WALLET_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(wallet));
}

export function WalletSessionProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<WalletSession | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setWallet(readStoredWallet());
    setReady(true);
  }, []);

  async function connectWallet() {
    setNotice("");
    setBusy(true);
    try {
      removeDefaultProvider();
      const response = await Wallet.request("wallet_connect", {
        addresses: [AddressPurpose.Payment],
        message: "Connect StelaKey to authorize Stellar actions"
      });
      if (response.status !== "success") {
        throw new Error(response.error.message || "Wallet connection was rejected.");
      }

      const paymentAddress = response.result.addresses.find(
        (address) => address.purpose === AddressPurpose.Payment
      );
      if (!paymentAddress) {
        throw new Error("The wallet did not return a Bitcoin payment address.");
      }

      const nextWallet = {
        provider: activeWalletProvider(),
        address: paymentAddress.address,
        publicKey: paymentAddress.publicKey,
        network: response.result.network.bitcoin.name
      };
      setWallet(nextWallet);
      storeWallet(nextWallet);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wallet connection failed.";
      setNotice(
        message.toLowerCase().includes("select the provider")
          ? "Wallet connection was cancelled."
          : message
      );
      setWallet(null);
      storeWallet(null);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function signMessage(message: string) {
    if (!wallet) throw new Error("Connect a wallet first.");

    const response = await Wallet.request("signMessage", {
      address: wallet.address,
      message,
      protocol: MessageSigningProtocols.ECDSA
    });
    if (response.status !== "success") {
      throw new Error(response.error.message || "Wallet signing was rejected.");
    }
    return response.result.signature;
  }

  function disconnect() {
    setWallet(null);
    setNotice("");
    storeWallet(null);
    void Wallet.disconnect();
  }

  function clearNotice() {
    setNotice("");
  }

  const value = useMemo(
    () => ({ wallet, ready, busy, notice, connectWallet, signMessage, clearNotice, disconnect }),
    [wallet, ready, busy, notice]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWalletSession() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWalletSession must be used inside WalletSessionProvider");
  return value;
}

export function compact(value: string, head = 8, tail = 6) {
  if (!value) return "";
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

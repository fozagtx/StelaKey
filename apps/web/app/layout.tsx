import type { Metadata } from "next";
import { WalletNoticeToast } from "../components/wallet-notice-toast";
import { WalletSessionProvider } from "../components/wallet-session";
import "./globals.css";

export const metadata: Metadata = {
  title: "StelaKey",
  description: "Bitcoin-wallet-controlled Stellar smart accounts with ZK authorization"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <WalletSessionProvider>
          <WalletNoticeToast />
          {children}
        </WalletSessionProvider>
      </body>
    </html>
  );
}

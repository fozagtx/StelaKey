"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider
} from "@/components/ui/sidebar";
import { ProductIcon } from "./product-icon";
import { WalletConnectButton } from "./wallet-connect-button";
import { compact, useWalletSession } from "./wallet-session";

const nav: Array<{ href: string; label: string }> = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/account", label: "Account" },
  { href: "/transfer", label: "Transfer" },
  { href: "/activity", label: "Activity" }
];

const SIDEBAR_WIDTH_KEY = "stelakey:sidebar-width";
const SIDEBAR_COLLAPSED_KEY = "stelakey:sidebar-collapsed";
const SIDEBAR_MIN_WIDTH = 172;
const SIDEBAR_MAX_WIDTH = 286;
const SIDEBAR_DEFAULT_WIDTH = 206;
const SIDEBAR_COLLAPSED_WIDTH = 62;

function clampSidebarWidth(value: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
}

function storedSidebarWidth() {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;

  try {
    const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(stored) ? clampSidebarWidth(stored) : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function storedSidebarCollapsed() {
  if (typeof window === "undefined") return false;

  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function DesktopExperienceGate() {
  return (
    <div className="desktop-experience-gate" role="status" aria-live="polite">
      <div>
        <h2>StelaKey is a desktop experience</h2>
        <p>Open this app on a laptop or desktop to connect a wallet, manage your account, and prepare payments safely.</p>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { wallet, ready, disconnect } = useWalletSession();
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    setSidebarWidth(storedSidebarWidth());
    setSidebarCollapsed(storedSidebarCollapsed());
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // Collapsing should still work if browser storage is blocked.
      }
      return next;
    });
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (sidebarCollapsed) return;

    dragRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function moveSidebarResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragRef.current || sidebarCollapsed) return;

    const nextWidth = clampSidebarWidth(dragRef.current.startWidth + event.clientX - dragRef.current.startX);
    setSidebarWidth(nextWidth);
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(nextWidth));
    } catch {
      // Resizing should still work if browser storage is blocked.
    }
  }

  function stopSidebarResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragRef.current) return;

    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  const sidebarStyle = {
    "--sidebar-width": `${sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth}px`
  } as CSSProperties;

  if (!ready) {
    return (
      <main className="protected-gate">
        <Link className="gate-brand" href="/">
          StelaKey
        </Link>
        <Card className="gate-card">
          <CardContent className="gate-card-content">
            <span className="soft-icon soft-icon-xl" aria-hidden="true">
              <ProductIcon name="wallet" size={58} />
            </span>
            <Badge variant="outline" className="soft-badge">Restoring wallet</Badge>
            <h1>Opening workspace</h1>
            <p>Checking the wallet session stored in this browser.</p>
          </CardContent>
        </Card>
        <DesktopExperienceGate />
      </main>
    );
  }

  if (!wallet) {
    return (
      <main className="protected-gate">
        <Link className="gate-brand" href="/">
          StelaKey
        </Link>
        <Card className="gate-card">
          <CardContent className="gate-card-content">
            <span className="soft-icon soft-icon-xl" aria-hidden="true">
              <ProductIcon name="wallet" size={58} />
            </span>
            <Badge variant="outline" className="soft-badge">Wallet required</Badge>
            <h1>Connect Wallet</h1>
            <p>Bring your Bitcoin wallet to Stellar before opening the app workspace.</p>
            <div className="button-row">
              <WalletConnectButton size="lg" />
              <Button asChild variant="secondary" size="lg">
                <Link href="/">Back home</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
        <DesktopExperienceGate />
      </main>
    );
  }

  return (
    <SidebarProvider style={sidebarStyle}>
      <Sidebar className={sidebarCollapsed ? "collapsed" : ""}>
        <button
          type="button"
          className="sidebar-toggle-button"
          aria-label={sidebarCollapsed ? "Open sidebar" : "Close sidebar"}
          aria-expanded={!sidebarCollapsed}
          onClick={toggleSidebar}
        >
          <ProductIcon name={sidebarCollapsed ? "panelOpen" : "panelClose"} size={20} strokeWidth={2} />
        </button>
        <SidebarHeader>
          <Link className="sidebar-brand" href="/dashboard" aria-label="StelaKey dashboard">
            <span className="brand">
              StelaKey
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu aria-label="Application">
                {nav.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild className={pathname === item.href ? "active" : ""}>
                      <Link href={item.href}>
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <div className="sidebar-wallet" aria-label="Connected wallet">
          <span className="sidebar-wallet-label">Wallet</span>
          <div className="sidebar-wallet-address">
            <ProductIcon name="wallet" size={18} />
            <span>{compact(wallet.address, 8, 5)}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={disconnect}>Disconnect</Button>
        </div>
        <button
          type="button"
          className="sidebar-resize-handle"
          aria-label="Resize sidebar"
          onPointerDown={startSidebarResize}
          onPointerMove={moveSidebarResize}
          onPointerUp={stopSidebarResize}
          onPointerCancel={stopSidebarResize}
        />
      </Sidebar>

      <SidebarInset>
        {children}
      </SidebarInset>
      <DesktopExperienceGate />
    </SidebarProvider>
  );
}

"use client";

import { AppShell } from "../../components/app-shell";

export default function DashboardPage() {
  return (
    <AppShell>
      <section className="dashboard-overview">
        <div className="hero-panel">
          <div className="hero-panel-copy">
            <span className="eyebrow">Workspace</span>
            <h1>Your Bitcoin wallet has a Stellar desk now.</h1>
            <p>Use the sidebar to open the account, transfer, and activity screens.</p>
          </div>
        </div>
      </section>
    </AppShell>
  );
}

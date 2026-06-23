"use client";

import { AppShell } from "../../components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ActivityPage() {
  return (
    <AppShell>
      <Card className="activity-card activity-page-card">
        <CardHeader className="activity-page-header">
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="activity-empty-state">
            <h2>No activity yet.</h2>
            <p>Confirmed account and payment events will appear here.</p>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}

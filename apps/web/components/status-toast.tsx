"use client";

import { useEffect } from "react";

type StatusToastProps = {
  title: string;
  message: string;
  onDismiss: () => void;
  tone?: "info" | "error" | "success";
};

export function StatusToast({ title, message, onDismiss, tone = "info" }: StatusToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, 6400);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div className={`app-toast ${tone}`} role={tone === "error" ? "alert" : "status"} aria-live="polite">
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss notice">
        x
      </button>
    </div>
  );
}

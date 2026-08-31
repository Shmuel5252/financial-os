"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { messages, userFacingErrorMessage } from "@/lib/i18n";

export function DashboardRefresh({
  hasSnapshot,
}: Readonly<{ hasSnapshot: boolean }>) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  async function calculate() {
    setWorking(true);
    setMessage("");
    idempotencyKey.current ??= crypto.randomUUID();

    try {
      const response = await fetch("/api/financial-engine/snapshots", {
        body: JSON.stringify({
          horizonDays: 30,
          idempotencyKey: idempotencyKey.current,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(
          userFacingErrorMessage(payload, messages.errors.recordSave),
        );
      }

      idempotencyKey.current = null;
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : messages.errors.recordSave,
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <div>
      <button
        className="rounded-2xl bg-[var(--accent)] px-5 py-3 font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
        disabled={working}
        onClick={() => void calculate()}
        type="button"
      >
        {working
          ? messages.dashboard.actions.calculating
          : hasSnapshot
            ? messages.dashboard.actions.refresh
            : messages.dashboard.actions.calculate}
      </button>
      <p aria-live="polite" className="mt-3 text-sm text-rose-800">
        {message}
      </p>
    </div>
  );
}

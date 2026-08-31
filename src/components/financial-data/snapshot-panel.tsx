"use client";

import { useRef, useState } from "react";

import type { FinancialSnapshotView } from "@/lib/financial-snapshots/financial-snapshot";
import { appLocale, messages, userFacingErrorMessage } from "@/lib/i18n";

type SnapshotResponse = Readonly<{ snapshot: FinancialSnapshotView }>;

function recordCount(snapshot: FinancialSnapshotView): number {
  return snapshot.sources.reduce(
    (total, source) => total + source.records.length,
    0,
  );
}

export function SnapshotPanel({
  initialSnapshot,
}: Readonly<{ initialSnapshot: FinancialSnapshotView | null }>) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  async function capture() {
    setWorking(true);
    setMessage("");
    idempotencyKey.current ??= crypto.randomUUID();

    try {
      const response = await fetch("/api/financial-data/snapshots", {
        body: JSON.stringify({ idempotencyKey: idempotencyKey.current }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(
          userFacingErrorMessage(payload, messages.errors.recordSave),
        );
      }

      const result = payload as SnapshotResponse;
      setSnapshot(result.snapshot);
      idempotencyKey.current = null;
      setMessage(messages.financialData.snapshot.saved);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : messages.errors.recordSave,
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
      <h2 className="text-xl font-semibold">
        {messages.financialData.snapshot.title}
      </h2>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        {messages.financialData.snapshot.description}
      </p>
      {snapshot === null ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          {messages.financialData.snapshot.empty}
        </p>
      ) : (
        <div className="mt-4 rounded-2xl bg-[var(--background)] p-4 text-sm">
          <p className="font-semibold">{messages.financialData.snapshot.latest}</p>
          <p className="mt-2 text-[var(--muted)]">
            <bdi dir="ltr">
              {new Intl.DateTimeFormat(appLocale.intlLocale, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(snapshot.capturedAt))}
            </bdi>
            {" · "}
            {messages.financialData.snapshot.sourceCount(recordCount(snapshot))}
          </p>
        </div>
      )}
      <button
        className="mt-5 rounded-2xl border border-[var(--accent)] px-5 py-3 font-semibold text-[var(--accent)] disabled:opacity-50"
        disabled={working}
        onClick={() => void capture()}
        type="button"
      >
        {working
          ? messages.financialData.actions.capturingSnapshot
          : messages.financialData.actions.captureSnapshot}
      </button>
      <p aria-live="polite" className="mt-3 text-sm text-[var(--muted)]">
        {message}
      </p>
    </section>
  );
}

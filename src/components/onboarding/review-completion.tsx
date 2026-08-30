"use client";

import { useState } from "react";

type ReviewCompletionProps = Readonly<{
  canComplete: boolean;
  completed: boolean;
  profileVersion: number;
}>;

type ErrorResponse = Readonly<{
  error?: Readonly<{ message?: string }>;
}>;

export function ReviewCompletion({
  canComplete,
  completed,
  profileVersion,
}: ReviewCompletionProps) {
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  async function finish() {
    setWorking(true);
    setMessage("");

    try {
      const response = await fetch("/api/onboarding/progress", {
        body: JSON.stringify({
          expectedVersion: profileVersion,
          step: "review",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const error = payload as ErrorResponse;
        throw new Error(error.error?.message ?? "Onboarding could not be completed.");
      }

      window.location.reload();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Onboarding could not be completed.",
      );
      setWorking(false);
    }
  }

  if (completed) {
    return (
      <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
        Manual onboarding is complete. Your records remain available for review and
        correction.
      </div>
    );
  }

  return (
    <div className="mt-8">
      <button
        className="w-full rounded-2xl bg-[var(--accent)] px-5 py-3.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!canComplete || working}
        onClick={() => void finish()}
        type="button"
      >
        {working ? "Completing…" : "Complete manual onboarding"}
      </button>
      {!canComplete ? (
        <p className="mt-3 text-sm text-[var(--muted)]">
          Finish the current onboarding step before completing the review.
        </p>
      ) : null}
      <p aria-live="polite" className="mt-3 text-sm text-red-700">
        {message}
      </p>
    </div>
  );
}

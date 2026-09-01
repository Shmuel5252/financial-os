"use client";

import { useState } from "react";

import {
  systemCategoryKey,
  type BudgetCategoryView,
  type SystemBudgetCategoryKey,
} from "@/lib/budgets/budget";
import type { SerializedMoney } from "@/lib/domain/money/money";
import { appLocale, messages, userFacingErrorMessage } from "@/lib/i18n";
import type {
  TransactionIntelligenceReviewDecision,
  TransactionIntelligenceRunView,
  TransactionIntelligenceSignalView,
} from "@/lib/transaction-intelligence/transaction-intelligence";

type RunResponse = Readonly<{ run: TransactionIntelligenceRunView }>;

function fractionDigits(currency: string): number {
  return (
    new Intl.NumberFormat(appLocale.intlLocale, {
      currency,
      style: "currency",
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

function moneyMajor(value: SerializedMoney): string {
  const digits = fractionDigits(value.currency);
  const negative = value.amountMinor.startsWith("-");
  const unsigned = negative ? value.amountMinor.slice(1) : value.amountMinor;
  const padded = unsigned.padStart(digits + 1, "0");
  return `${negative ? "-" : ""}${
    digits === 0
      ? padded
      : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`
  }`;
}

function MoneyValue({ value }: Readonly<{ value: SerializedMoney }>) {
  return (
    <bdi className="break-all tabular-nums" dir="ltr">
      {moneyMajor(value)} {value.currency}
    </bdi>
  );
}

function categoryLabel(
  categoryId: string,
  categories: readonly BudgetCategoryView[],
): string {
  const category = categories.find((item) => item.categoryId === categoryId);
  if (category?.label !== null && category?.label !== undefined) {
    return category.label;
  }
  const key = systemCategoryKey(categoryId);
  if (key !== null) {
    return messages.budgets.systemCategories[
      key as SystemBudgetCategoryKey
    ];
  }
  return categoryId;
}

async function requestJson(url: string, body: unknown): Promise<RunResponse> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      userFacingErrorMessage(
        payload,
        messages.transactionIntelligence.failure,
      ),
    );
  }
  return payload as RunResponse;
}

function reviewText(decision: TransactionIntelligenceReviewDecision | null) {
  return decision === null
    ? messages.transactionIntelligence.review.pending
    : messages.transactionIntelligence.review[decision];
}

function SignalCard({
  categories,
  onReview,
  signal,
  workingSignalId,
}: Readonly<{
  categories: readonly BudgetCategoryView[];
  onReview: (
    signal: TransactionIntelligenceSignalView,
    decision: TransactionIntelligenceReviewDecision,
  ) => Promise<void>;
  signal: TransactionIntelligenceSignalView;
  workingSignalId: string | null;
}>) {
  const pending =
    signal.currentDecision === null || signal.currentDecision === "reopened";
  const working = workingSignalId === signal.id;

  return (
    <li className="rounded-3xl border border-[var(--border)] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--accent)]">
            {messages.transactionIntelligence.kinds[signal.kind]}
          </p>
          <h3 className="mt-1 text-xl font-semibold">
            {signal.normalizedMerchant ?? messages.financialData.sections.transactions.label}
          </h3>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {messages.transactionIntelligence.confidence(signal.confidenceBps)}
          </p>
        </div>
        <MoneyValue value={signal.amount} />
      </div>

      <p className="mt-4 leading-7">
        {messages.transactionIntelligence.explanations[signal.explanationCode]}
      </p>
      {signal.suggestedCategoryId === null ? null : (
        <p className="mt-3 rounded-2xl bg-[var(--background)] p-3">
          {messages.transactionIntelligence.categorySuggestion}: {" "}
          <strong>
            {categoryLabel(signal.suggestedCategoryId, categories)}
          </strong>
        </p>
      )}
      {signal.baselineAmount === null ? null : (
        <p className="mt-3 text-sm text-[var(--muted)]">
          <MoneyValue value={signal.baselineAmount} />
        </p>
      )}
      {signal.periodDays === null ? null : (
        <p className="mt-3 text-sm text-[var(--muted)]">
          {messages.transactionIntelligence.period(signal.periodDays)}
        </p>
      )}

      <details className="mt-4 rounded-2xl bg-[var(--background)] p-4">
        <summary className="cursor-pointer font-semibold">
          {messages.transactionIntelligence.evidence}
        </summary>
        <ul className="mt-3 space-y-3">
          {signal.evidence.map((item, index) => (
            <li className="text-sm" key={`${item.date}-${index}`}>
              <div className="flex flex-wrap justify-between gap-3">
                <span>{item.rawMerchant ?? item.normalizedMerchant ?? "—"}</span>
                <MoneyValue value={item.amount} />
              </div>
              <bdi className="text-[var(--muted)]" dir="ltr">
                {item.date}
              </bdi>
            </li>
          ))}
        </ul>
      </details>

      <p className="mt-4 text-sm font-semibold" role="status">
        {reviewText(signal.currentDecision)}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {pending ? (
          <>
            <button
              className="rounded-xl bg-[var(--accent)] px-4 py-2 font-semibold text-white disabled:opacity-60"
              disabled={working}
              onClick={() => void onReview(signal, "confirmed")}
              type="button"
            >
              {working
                ? messages.transactionIntelligence.actions.reviewing
                : messages.transactionIntelligence.actions.confirm}
            </button>
            <button
              className="rounded-xl border border-[var(--border)] px-4 py-2 font-semibold disabled:opacity-60"
              disabled={working}
              onClick={() => void onReview(signal, "dismissed")}
              type="button"
            >
              {messages.transactionIntelligence.actions.dismiss}
            </button>
          </>
        ) : signal.currentDecision === "dismissed" ? (
          <button
            className="rounded-xl border border-[var(--accent)] px-4 py-2 font-semibold text-[var(--accent)] disabled:opacity-60"
            disabled={working}
            onClick={() => void onReview(signal, "reopened")}
            type="button"
          >
            {working
              ? messages.transactionIntelligence.actions.reviewing
              : messages.transactionIntelligence.actions.reopen}
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function TransactionIntelligenceReview({
  categories,
  initialRun,
}: Readonly<{
  categories: readonly BudgetCategoryView[];
  initialRun: TransactionIntelligenceRunView | null;
}>) {
  const [run, setRun] = useState(initialRun);
  const [working, setWorking] = useState(false);
  const [workingSignalId, setWorkingSignalId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function analyze() {
    setWorking(true);
    setMessage("");
    try {
      const response = await requestJson(
        "/api/transaction-intelligence/runs",
        { idempotencyKey: crypto.randomUUID() },
      );
      setRun(response.run);
      setMessage(messages.transactionIntelligence.status.analyzed);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : messages.transactionIntelligence.failure,
      );
    } finally {
      setWorking(false);
    }
  }

  async function review(
    signal: TransactionIntelligenceSignalView,
    decision: TransactionIntelligenceReviewDecision,
  ) {
    if (run === null) return;
    setWorkingSignalId(signal.id);
    setMessage("");
    try {
      const response = await requestJson(
        "/api/transaction-intelligence/reviews",
        {
          decision,
          expectedDecision: signal.currentDecision,
          idempotencyKey: crypto.randomUUID(),
          runId: run.id,
          signalId: signal.id,
        },
      );
      setRun(response.run);
      setMessage(messages.transactionIntelligence.status.reviewed);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : messages.transactionIntelligence.failure,
      );
    } finally {
      setWorkingSignalId(null);
    }
  }

  return (
    <div className="mt-8 space-y-8">
      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <p className="leading-7 text-[var(--muted)]">
          {messages.transactionIntelligence.privacy}
        </p>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          {messages.transactionIntelligence.separation}
        </p>
        <button
          className="mt-5 rounded-2xl bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-60"
          disabled={working}
          onClick={() => void analyze()}
          type="button"
        >
          {working
            ? messages.transactionIntelligence.actions.analyzing
            : messages.transactionIntelligence.actions.analyze}
        </button>
        <p className="mt-4 text-sm font-semibold" role="status">
          {message}
        </p>
      </section>

      {run === null ? (
        <p className="rounded-3xl border border-[var(--border)] bg-white p-6 text-[var(--muted)]">
          {messages.transactionIntelligence.empty}
        </p>
      ) : (
        <>
          <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
            <h2 className="text-2xl font-semibold">
              {messages.transactionIntelligence.signals.title}
            </h2>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-sm text-[var(--muted)]">
                  {messages.transactionIntelligence.summary.analyzedAt}
                </dt>
                <dd><bdi dir="ltr">{run.createdAt}</bdi></dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--muted)]">
                  {messages.transactionIntelligence.summary.through}
                </dt>
                <dd><bdi dir="ltr">{run.analyzedThroughDate ?? "—"}</bdi></dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--muted)]">
                  {messages.transactionIntelligence.summary.reviewThreshold}
                </dt>
                <dd><bdi dir="ltr">{(run.reviewThresholdBps / 100).toFixed(2)}%</bdi></dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--muted)]">
                  {messages.transactionIntelligence.summary.engineVersion}
                </dt>
                <dd><bdi dir="ltr">{run.engineVersion}</bdi></dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--muted)]">
                  {messages.transactionIntelligence.summary.rulesetVersion}
                </dt>
                <dd><bdi dir="ltr">{run.rulesetVersion}</bdi></dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--muted)]">
                  {messages.transactionIntelligence.summary.policyVersion}
                </dt>
                <dd><bdi dir="ltr">{run.policyVersion}</bdi></dd>
              </div>
            </dl>
            <p className="mt-4">
              {messages.transactionIntelligence.summary.inputCount(run.inputCount)}
            </p>
            {run.omittedLowConfidenceCount === 0 ? null : (
              <p className="mt-2 text-sm text-[var(--muted)]">
                {messages.transactionIntelligence.signals.omitted(
                  run.omittedLowConfidenceCount,
                )}
              </p>
            )}
            {run.truncatedSignalCount === 0 ? null : (
              <p className="mt-2 text-sm text-[var(--muted)]">
                {messages.transactionIntelligence.signals.truncated(
                  run.truncatedSignalCount,
                )}
              </p>
            )}
          </section>

          {run.signals.length === 0 ? (
            <p className="rounded-3xl border border-[var(--border)] bg-white p-6 text-[var(--muted)]">
              {messages.transactionIntelligence.signals.empty}
            </p>
          ) : (
            <ul className="space-y-5">
              {run.signals.map((signal) => (
                <SignalCard
                  categories={categories}
                  key={signal.id}
                  onReview={review}
                  signal={signal}
                  workingSignalId={workingSignalId}
                />
              ))}
            </ul>
          )}

          <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
            <h2 className="text-2xl font-semibold">
              {messages.transactionIntelligence.merchantGroups.title}
            </h2>
            <p className="mt-3 leading-7 text-[var(--muted)]">
              {messages.transactionIntelligence.merchantGroups.description}
            </p>
            {run.merchantGroups.length === 0 ? (
              <p className="mt-4 text-[var(--muted)]">
                {messages.transactionIntelligence.merchantGroups.empty}
              </p>
            ) : (
              <ul className="mt-5 grid gap-4 md:grid-cols-2">
                {run.merchantGroups.map((group) => (
                  <li
                    className="rounded-2xl bg-[var(--background)] p-4"
                    key={group.normalizedMerchant}
                  >
                    <p className="font-semibold">{group.normalizedMerchant}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {messages.transactionIntelligence.merchantGroups.original}: {" "}
                      {group.latestRawMerchant}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {messages.transactionIntelligence.merchantGroups.occurrenceCount(
                        group.occurrenceCount,
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

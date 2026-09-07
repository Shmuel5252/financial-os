"use client";

import { useRef, useState } from "react";
import Link from "next/link";

import { appLocale, messages, userFacingErrorMessage } from "@/lib/i18n";
import type { OpenBankingCenterView } from "@/lib/open-banking/open-banking";

type CenterResponse = Readonly<{ center: OpenBankingCenterView }>;

function formatMoney(amountMinor: string, currency: string): string {
  const digits = new Intl.NumberFormat(appLocale.intlLocale, { currency, style: "currency" }).resolvedOptions().maximumFractionDigits ?? 2;
  const negative = amountMinor.startsWith("-");
  const unsigned = negative ? amountMinor.slice(1) : amountMinor;
  const padded = unsigned.padStart(digits + 1, "0");
  const major = digits === 0 ? padded : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
  return `${negative ? "-" : ""}${major} ${currency}`;
}

function formatInstant(value: string | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat(appLocale.intlLocale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(new Date(value));
}

function connectionStatus(status: string): string {
  return messages.openBanking.connectionStatuses[status as keyof typeof messages.openBanking.connectionStatuses] ?? `מצב ספק: ${status}`;
}

export function OpenBankingCenter({ initialCenter }: Readonly<{ initialCenter: OpenBankingCenterView }>) {
  const [center, setCenter] = useState(initialCenter);
  const [claimConfirmed, setClaimConfirmed] = useState(false);
  const [refreshConfirmed, setRefreshConfirmed] = useState(false);
  const [disconnectConfirmed, setDisconnectConfirmed] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const syncKey = useRef<string | null>(null);
  const refreshKey = useRef<string | null>(null);

  async function mutate(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(path, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(userFacingErrorMessage(payload, "לא הצלחנו להשלים את פעולת החיבור הבנקאי."));
    return payload;
  }

  async function claim() {
    setWorking(true); setMessage("");
    try {
      const payload = await mutate("/api/open-banking/claim", { confirmation: "CLAIM_CONFIGURED_FINANCY_SUBJECT" }) as CenterResponse;
      setCenter(payload.center); setClaimConfirmed(false); setMessage(messages.openBanking.messages.claimed);
    } catch (error) { setMessage(error instanceof Error ? error.message : "השיוך נכשל."); }
    finally { setWorking(false); }
  }

  async function synchronize() {
    setWorking(true); setMessage("");
    try {
      syncKey.current ??= crypto.randomUUID();
      const payload = await mutate("/api/open-banking/sync", { idempotencyKey: syncKey.current }) as CenterResponse;
      setCenter(payload.center); syncKey.current = null; setMessage(messages.openBanking.messages.synced);
    } catch (error) { setMessage(error instanceof Error ? error.message : "הסנכרון נכשל."); }
    finally { setWorking(false); }
  }

  async function refresh() {
    setWorking(true); setMessage("");
    try {
      refreshKey.current ??= crypto.randomUUID();
      await mutate("/api/open-banking/refresh", { confirmation: "CONFIRM_20_CREDIT_REFRESH", idempotencyKey: refreshKey.current });
      refreshKey.current = null; setRefreshConfirmed(false); setMessage(messages.openBanking.messages.refreshed);
    } catch (error) { setMessage(error instanceof Error ? error.message : "בקשת הרענון נכשלה."); }
    finally { setWorking(false); }
  }

  async function disconnect(connectionId: string, expectedVersion: number) {
    setWorking(true); setMessage("");
    try {
      await mutate("/api/open-banking/disconnect", {
        confirmation: "DELETE_FINANCY_CONNECTION",
        connectionId,
        expectedVersion,
        idempotencyKey: crypto.randomUUID(),
      });
      const response = await fetch("/api/open-banking", { cache: "no-store" });
      const payload = await response.json() as CenterResponse;
      setCenter(payload.center); setDisconnectConfirmed(null); setMessage(messages.openBanking.messages.disconnected);
    } catch (error) { setMessage(error instanceof Error ? error.message : "הניתוק נכשל."); }
    finally { setWorking(false); }
  }

  if (!center.configured) {
    return <section className="mt-8 rounded-3xl border border-amber-300 bg-amber-50 p-6"><p>{messages.openBanking.notConfigured}</p></section>;
  }

  return (
    <div className="mt-8 space-y-6">
      {center.bindingClaimed ? <Link className="block rounded-2xl border border-amber-300 bg-amber-50 p-4 font-semibold" href="/open-banking/reconciliation">{messages.openBanking.reconciliation.title}</Link> : null}
      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <p className="font-semibold">{messages.openBanking.configured}</p>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{messages.openBanking.privacy}</p>
        {!center.bindingClaimed ? (
          <div className="mt-5 space-y-4">
            <label className="flex items-start gap-3 text-sm leading-6">
              <input checked={claimConfirmed} className="mt-1" onChange={(event) => setClaimConfirmed(event.target.checked)} type="checkbox" />
              <span>{messages.openBanking.claimConfirmation}</span>
            </label>
            <button className="rounded-2xl bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={!claimConfirmed || working} onClick={() => void claim()} type="button">
              {working ? messages.openBanking.actions.working : messages.openBanking.actions.claim}
            </button>
          </div>
        ) : (
          <button className="mt-5 rounded-2xl bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={working} onClick={() => void synchronize()} type="button">
            {working ? messages.openBanking.actions.working : messages.openBanking.actions.sync}
          </button>
        )}
        <p aria-live="polite" className="mt-4 text-sm font-semibold text-[var(--accent)]">{message}</p>
      </section>

      {center.latestRun === null ? null : (
        <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-xl font-semibold">{messages.openBanking.run.title}</h2>
          <p className="mt-2">{messages.openBanking.runStatuses[center.latestRun.status]}</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              [messages.openBanking.run.connections, center.latestRun.connectionObservationCount],
              [messages.openBanking.run.accounts, center.latestRun.accountObservationCount],
              [messages.openBanking.run.transactions, center.latestRun.transactionObservationCount],
              [messages.openBanking.run.canonicalAccounts, center.latestRun.canonicalAccountCount],
              [messages.openBanking.run.canonicalTransactions, center.latestRun.canonicalTransactionCount],
            ].map(([label, value]) => <div className="rounded-2xl bg-[var(--background)] p-4" key={String(label)}><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="mt-1 text-xl font-semibold"><bdi dir="ltr">{value}</bdi></dd></div>)}
          </dl>
          {center.latestRun.errorCategory === null ? null : <p className="mt-4 text-sm text-red-800">{messages.openBanking.run.error}: <bdi dir="ltr">{center.latestRun.errorCategory}</bdi></p>}
        </section>
      )}

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-xl font-semibold">חיבורים והסכמה</h2>
        {center.connections.length === 0 ? <p className="mt-4 text-[var(--muted)]">{messages.openBanking.emptyConnections}</p> : (
          <ul className="mt-4 space-y-4">
            {center.connections.map((connection, index) => (
              <li className="rounded-2xl bg-[var(--background)] p-5" key={connection.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h3 className="font-semibold">חיבור בנקאי {index + 1}</h3><p className="mt-1 text-sm">{connectionStatus(connection.status)}</p></div>
                  <span className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-xs font-semibold">{messages.openBanking.freshness[connection.freshness]}</span>
                </div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <div><dt className="text-[var(--muted)]">{messages.openBanking.connection.lastData}</dt><dd><bdi dir="ltr">{connection.lastFetchedDataDate ?? "—"}</bdi></dd></div>
                  <div><dt className="text-[var(--muted)]">{messages.openBanking.connection.lastFetch}</dt><dd><bdi dir="ltr">{formatInstant(connection.lastFetchedAt)}</bdi></dd></div>
                  <div><dt className="text-[var(--muted)]">{messages.openBanking.connection.consentExpiry}</dt><dd><bdi dir="ltr">{connection.consentExpiresOn ?? "—"}</bdi></dd></div>
                  <div><dt className="text-[var(--muted)]">{messages.openBanking.connection.accounts}</dt><dd><bdi dir="ltr">{connection.accountCount}</bdi></dd></div>
                  <div><dt className="text-[var(--muted)]">{messages.openBanking.connection.transactions}</dt><dd><bdi dir="ltr">{connection.transactionCount}</bdi></dd></div>
                  <div><dt className="text-[var(--muted)]">{messages.openBanking.connection.mode}</dt><dd><bdi dir="ltr">{connection.mode ?? "—"}</bdi></dd></div>
                </dl>
                <label className="mt-5 flex items-start gap-3 text-sm leading-6">
                  <input checked={disconnectConfirmed === connection.id} className="mt-1" onChange={(event) => setDisconnectConfirmed(event.target.checked ? connection.id : null)} type="checkbox" />
                  <span>{messages.openBanking.disconnectConfirmation}</span>
                </label>
                <button className="mt-3 rounded-2xl border border-red-700 px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-50" disabled={disconnectConfirmed !== connection.id || working} onClick={() => void disconnect(connection.id, connection.version)} type="button">{messages.openBanking.actions.disconnect}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-xl font-semibold">חשבונות ויתרות</h2>
        {center.accounts.length === 0 ? <p className="mt-4 text-[var(--muted)]">{messages.openBanking.emptyAccounts}</p> : (
          <ul className="mt-4 grid gap-4 md:grid-cols-2">{center.accounts.map((account, index) => (
            <li className="rounded-2xl bg-[var(--background)] p-5" key={`${account.displayName}:${account.type}:${index}`}>
              <h3 className="font-semibold">{account.displayName}</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">{messages.openBanking.accountTypes[account.type]} · <bdi dir="ltr">{account.currency}</bdi></p>
              <p className="mt-4 text-sm font-semibold">{messages.openBanking.balances}</p>
              <ul className="mt-2 space-y-2">{account.balances.map((balance, balanceIndex) => <li className="flex flex-wrap justify-between gap-2 text-sm" key={`${balance.type}:${balanceIndex}`}><span><bdi dir="ltr">{balance.type}</bdi></span><bdi dir="ltr">{formatMoney(balance.amount.amountMinor, balance.amount.currency)}</bdi></li>)}</ul>
            </li>
          ))}</ul>
        )}
      </section>

      {center.bindingClaimed ? (
        <section className="rounded-3xl border border-amber-300 bg-amber-50 p-6">
          <h2 className="text-xl font-semibold">רענון יזום בתשלום</h2>
          <label className="mt-4 flex items-start gap-3 text-sm leading-6">
            <input checked={refreshConfirmed} className="mt-1" onChange={(event) => setRefreshConfirmed(event.target.checked)} type="checkbox" />
            <span>{messages.openBanking.refreshConfirmation}</span>
          </label>
          <button className="mt-4 rounded-2xl border border-amber-700 px-5 py-3 font-semibold text-amber-900 disabled:opacity-50" disabled={!refreshConfirmed || working} onClick={() => void refresh()} type="button">{messages.openBanking.actions.refresh}</button>
        </section>
      ) : null}
      <p className="text-sm leading-6 text-[var(--muted)]">{messages.openBanking.separation}</p>
    </div>
  );
}

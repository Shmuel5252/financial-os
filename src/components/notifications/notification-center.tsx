"use client";

import Link from "next/link";
import { useState } from "react";

import { messages, userFacingErrorMessage } from "@/lib/i18n";
import type { NotificationCenterView, NotificationView } from "@/lib/notifications/notification";

async function requestJson<T>(url: string, method: "PATCH" | "POST" | "PUT", body: unknown): Promise<T> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(userFacingErrorMessage(payload, messages.notifications.failure));
  return payload as T;
}

export function NotificationCenter({ initialView }: Readonly<{ initialView: NotificationCenterView }>) {
  const [view, setView] = useState(initialView);
  const [emailEnabled, setEmailEnabled] = useState(view.preferences.emailEnabled);
  const [inAppEnabled, setInAppEnabled] = useState(view.preferences.inAppEnabled);
  const [quietEnabled, setQuietEnabled] = useState(view.preferences.quietHours.enabled);
  const [quietStart, setQuietStart] = useState(view.preferences.quietHours.startHour);
  const [quietEnd, setQuietEnd] = useState(view.preferences.quietHours.endHour);
  const [busy, setBusy] = useState<"evaluate" | "preferences" | "state" | null>(null);
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState("");

  async function savePreferences() {
    setBusy("preferences"); setStatus(""); setFailure("");
    try {
      const response = await requestJson<{ center: NotificationCenterView }>("/api/notification-preferences", "PUT", {
        emailEnabled,
        expectedVersion: view.preferences.version,
        inAppEnabled,
        quietHours: { enabled: quietEnabled, endHour: quietEnd, startHour: quietStart },
      });
      setView(response.center);
      setStatus(messages.notifications.status.preferencesSaved);
    } catch (error) { setFailure(error instanceof Error ? error.message : messages.notifications.failure); }
    finally { setBusy(null); }
  }

  async function evaluate() {
    setBusy("evaluate"); setStatus(""); setFailure("");
    try {
      const response = await requestJson<{ center: NotificationCenterView }>("/api/notifications/evaluate", "POST", {});
      setView(response.center);
      setStatus(messages.notifications.status.evaluated);
    } catch (error) { setFailure(error instanceof Error ? error.message : messages.notifications.failure); }
    finally { setBusy(null); }
  }

  async function updateState(notification: NotificationView, inAppState: "dismissed" | "read") {
    setBusy("state"); setStatus(""); setFailure("");
    try {
      const response = await requestJson<{ notification: NotificationView }>("/api/notifications", "PATCH", {
        expectedVersion: notification.version,
        id: notification.id,
        inAppState,
      });
      setView((current) => ({ ...current, notifications: current.notifications.map((item) => item.id === response.notification.id ? response.notification : item) }));
      setStatus(messages.notifications.status.updated);
    } catch (error) { setFailure(error instanceof Error ? error.message : messages.notifications.failure); }
    finally { setBusy(null); }
  }

  const visible = view.notifications.filter((notification) => notification.inAppState !== "dismissed");
  return (
    <div className="mt-9 space-y-8">
      <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm" aria-labelledby="notification-preferences-title">
        <h2 id="notification-preferences-title" className="text-2xl font-semibold">{messages.notifications.preferences.title}</h2>
        <div className="mt-5 grid gap-4">
          <label className="flex items-start gap-3"><input checked={inAppEnabled} onChange={(event) => setInAppEnabled(event.target.checked)} type="checkbox" className="mt-1" /><span>{messages.notifications.inApp.enabled}</span></label>
          <label className="flex items-start gap-3"><input checked={emailEnabled} onChange={(event) => setEmailEnabled(event.target.checked)} type="checkbox" className="mt-1" /><span>{messages.notifications.email.optIn}</span></label>
          <p className="text-sm leading-6 text-[var(--muted)]">{messages.notifications.email.privacy}</p>
          <p className={`text-sm font-semibold ${view.emailCapabilityReady ? "text-emerald-700" : "text-amber-800"}`} role="status">
            {view.emailCapabilityReady ? messages.notifications.email.configured : messages.notifications.email.notConfigured}
          </p>
          <label className="flex items-start gap-3"><input checked={quietEnabled} onChange={(event) => setQuietEnabled(event.target.checked)} type="checkbox" className="mt-1" /><span>{messages.notifications.preferences.quietEnabled}</span></label>
          {quietEnabled ? <div className="grid max-w-md gap-4 sm:grid-cols-2">
            <label className="grid gap-2">{messages.notifications.preferences.quietStart}<input aria-label={messages.notifications.preferences.quietStart} className="rounded-xl border border-[var(--border)] px-3 py-2" dir="ltr" max={23} min={0} onChange={(event) => setQuietStart(Number(event.target.value))} type="number" value={quietStart} /></label>
            <label className="grid gap-2">{messages.notifications.preferences.quietEnd}<input aria-label={messages.notifications.preferences.quietEnd} className="rounded-xl border border-[var(--border)] px-3 py-2" dir="ltr" max={23} min={0} onChange={(event) => setQuietEnd(Number(event.target.value))} type="number" value={quietEnd} /></label>
          </div> : <p className="text-sm text-[var(--muted)]">{messages.notifications.preferences.quietDisabled}</p>}
          <button className="w-fit rounded-2xl border border-[var(--accent)] px-5 py-3 font-semibold text-[var(--accent)] disabled:opacity-50" disabled={busy !== null} onClick={() => void savePreferences()} type="button">{busy === "preferences" ? messages.notifications.actions.saving : messages.notifications.actions.savePreferences}</button>
        </div>
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm" aria-labelledby="notification-list-title">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="notification-list-title" className="text-2xl font-semibold">{messages.notifications.title}</h2>
          <button className="rounded-2xl bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={busy !== null} onClick={() => void evaluate()} type="button">{busy === "evaluate" ? messages.notifications.actions.evaluating : messages.notifications.actions.evaluate}</button>
        </div>
        {visible.length === 0 ? <p className="mt-5 text-[var(--muted)]">{messages.notifications.empty}</p> : (
          <ol className="mt-6 space-y-4">
            {visible.map((notification) => {
              const copy = messages.notifications.messages[notification.messageKey];
              return <li key={notification.id} className={`rounded-2xl border p-5 ${notification.severity === "CRITICAL" ? "border-red-300 bg-red-50" : notification.severity === "WARNING" ? "border-amber-300 bg-amber-50" : "border-[var(--border)] bg-[var(--background)]"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold">{messages.notifications.severity[notification.severity]}</p><h3 className="mt-1 text-lg font-semibold">{copy.title}</h3></div><bdi className="text-xs text-[var(--muted)]" dir="ltr">{notification.createdAt}</bdi></div>
                <p className="mt-3 leading-7">{copy.description}</p>
                <p className="mt-3 text-sm text-[var(--muted)]">{messages.notifications.channel.email}: {messages.notifications.emailStates[notification.email.state]}</p>
                {notification.email.notBeforeAt === null ? null : <p className="mt-1 text-xs text-[var(--muted)]"><bdi dir="ltr">{notification.email.notBeforeAt}</bdi></p>}
                <div className="mt-4 flex flex-wrap gap-4 text-sm font-semibold"><Link href={notification.targetPath} className="text-[var(--accent)]">כניסה לפרטים המאובטחים</Link>{notification.inAppState === "unread" ? <button className="text-[var(--accent)]" disabled={busy !== null} onClick={() => void updateState(notification, "read")} type="button">{messages.notifications.actions.markRead}</button> : null}<button className="text-[var(--muted)]" disabled={busy !== null} onClick={() => void updateState(notification, "dismissed")} type="button">{messages.notifications.actions.dismiss}</button></div>
              </li>;
            })}
          </ol>
        )}
      </section>
      <p className="rounded-2xl border border-[var(--border)] bg-white p-4 text-sm text-[var(--muted)]">{messages.notifications.phase9}</p>
      <div aria-live="polite" className="min-h-6 text-sm font-semibold text-[var(--accent)]" role="status">{status}</div>
      {failure === "" ? null : <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{failure}</p>}
    </div>
  );
}

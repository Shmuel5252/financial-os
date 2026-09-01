"use client";

import { useMemo, useState, type FormEvent } from "react";

import type {
  AiConversationView,
  AiEvidenceFact,
  AiFocus,
  AiStructuredResponse,
} from "@/lib/ai/ai";
import type { ApplicationErrorCode } from "@/lib/errors/application-error";
import { appLocale, messages } from "@/lib/i18n";

type FinancialCopilotProps = Readonly<{
  configured: boolean;
  initialConversations: readonly AiConversationView[];
}>;

type PublicErrorBody = Readonly<{
  error?: Readonly<{ code?: ApplicationErrorCode }>;
}>;

const focusOptions: readonly AiFocus[] = [
  "safe_to_spend",
  "purchase",
  "goal",
  "monthly",
];

function formatMoney(amountMinor: string, currency: string): string {
  const digits =
    new Intl.NumberFormat(appLocale.intlLocale, {
      currency,
      style: "currency",
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const negative = amountMinor.startsWith("-");
  const unsigned = negative ? amountMinor.slice(1) : amountMinor;
  const padded = unsigned.padStart(digits + 1, "0");
  const major = digits === 0 ? padded : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
  return `${negative ? "-" : ""}${major} ${currency}`;
}

function formatBasisPoints(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const padded = unsigned.padStart(3, "0");
  return `${negative ? "-" : ""}${padded.slice(0, -2)}.${padded.slice(-2)}%`;
}

function evidenceValue(fact: AiEvidenceFact): string {
  if (fact.value.kind === "money") {
    return formatMoney(fact.value.amountMinor, fact.value.currency);
  }
  if (fact.value.kind === "basis_points") {
    return formatBasisPoints(fact.value.value);
  }
  if (fact.value.kind === "status") {
    const labels = messages.copilot.status;
    return fact.value.value in labels
      ? labels[fact.value.value as keyof typeof labels]
      : fact.value.value;
  }
  return fact.value.value;
}

function ResponseSection({
  evidence,
  items,
  title,
}: Readonly<{
  evidence: readonly AiEvidenceFact[];
  items: AiStructuredResponse[keyof AiStructuredResponse];
  title: string;
}>) {
  const evidenceByRef = new Map(evidence.map((fact) => [fact.ref, fact]));
  if (items.length === 0) return null;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
      <h4 className="font-semibold">{title}</h4>
      <ul className="mt-3 space-y-4">
        {items.map((item, index) => (
          <li key={`${index}-${item.text}`}>
            <p className="leading-7">{item.text}</p>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              {item.evidenceRefs.map((reference) => {
                const fact = evidenceByRef.get(reference);
                if (fact === undefined) return null;
                return (
                  <div className="rounded-xl bg-white px-3 py-2 text-sm" key={reference}>
                    <dt className="text-[var(--muted)]">
                      {messages.copilot.evidence[fact.label]}
                    </dt>
                    <dd className="mt-1 font-semibold">
                      <bdi dir="ltr">{evidenceValue(fact)}</bdi>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FinancialCopilot({ configured, initialConversations }: FinancialCopilotProps) {
  const [conversations, setConversations] = useState([...initialConversations]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<AiFocus>("safe_to_spend");
  const [includeRecentHistory, setIncludeRecentHistory] = useState(false);
  const [question, setQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  function startNewConversation() {
    setSelectedId(null);
    setIncludeRecentHistory(false);
    setNotice(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured || submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const response = await fetch("/api/ai/conversations", {
        body: JSON.stringify({
          ...(selectedConversation === null
            ? {}
            : {
                conversationId: selectedConversation.id,
                expectedVersion: selectedConversation.version,
              }),
          focus,
          includeRecentHistory: selectedConversation === null ? false : includeRecentHistory,
          question,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as
        | Readonly<{ conversation: AiConversationView }>
        | PublicErrorBody;
      if (!response.ok || !("conversation" in body)) {
        const code = "error" in body ? body.error?.code : undefined;
        setNotice(
          code === undefined ? messages.errors.public.INTERNAL_ERROR : messages.errors.public[code],
        );
        return;
      }
      const conversation = body.conversation;
      setConversations((current) => [
        conversation,
        ...current.filter((item) => item.id !== conversation.id),
      ]);
      setSelectedId(conversation.id);
      setQuestion("");
      setIncludeRecentHistory(false);
      const lastUser = [...conversation.messages].reverse().find((message) => message.role === "user");
      if (lastUser?.role === "user" && lastUser.text.includes("[REDACTED_")) {
        setNotice(messages.copilot.redacted);
      }
    } catch {
      setNotice(messages.errors.public.DEPENDENCY_UNAVAILABLE);
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteConversation(conversation: AiConversationView) {
    if (deletingId !== null) return;
    setDeletingId(conversation.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/ai/conversations/${conversation.id}`, {
        body: JSON.stringify({ expectedVersion: conversation.version }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json()) as PublicErrorBody;
        const code = body.error?.code;
        setNotice(
          code === undefined ? messages.errors.public.INTERNAL_ERROR : messages.errors.public[code],
        );
        return;
      }
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
      if (selectedId === conversation.id) startNewConversation();
    } catch {
      setNotice(messages.errors.public.DEPENDENCY_UNAVAILABLE);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mt-10 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <section className="rounded-3xl border border-[var(--border)] bg-white p-6 sm:p-8">
        <h2 className="text-2xl font-semibold">{messages.copilot.form.question}</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          {configured ? messages.copilot.configured.ready : messages.copilot.configured.missing}
        </p>
        <form className="mt-6 space-y-5" onSubmit={submit}>
          <label className="block font-semibold">
            {messages.copilot.form.focus}
            <select
              className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3"
              onChange={(event) => setFocus(event.target.value as AiFocus)}
              value={focus}
            >
              {focusOptions.map((option) => (
                <option key={option} value={option}>
                  {messages.copilot.focus[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="block font-semibold">
            {messages.copilot.form.question}
            <textarea
              className="mt-2 min-h-32 w-full rounded-2xl border border-[var(--border)] px-4 py-3"
              maxLength={1_000}
              minLength={5}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={messages.copilot.form.questionPlaceholder}
              required
              value={question}
            />
          </label>
          {selectedConversation === null ? null : (
            <label className="flex items-start gap-3 rounded-2xl bg-[var(--background)] p-4">
              <input
                checked={includeRecentHistory}
                className="mt-1"
                onChange={(event) => setIncludeRecentHistory(event.target.checked)}
                type="checkbox"
              />
              <span>
                <span className="block font-semibold">{messages.copilot.form.history}</span>
                <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">
                  {messages.copilot.form.historyHelp}
                </span>
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-2xl bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-50"
              disabled={!configured || submitting}
              type="submit"
            >
              {submitting ? messages.copilot.actions.sending : messages.copilot.actions.send}
            </button>
            {selectedConversation === null ? null : (
              <button
                className="rounded-2xl border border-[var(--border)] px-5 py-3 font-semibold"
                onClick={startNewConversation}
                type="button"
              >
                {messages.copilot.actions.newConversation}
              </button>
            )}
          </div>
        </form>
        {notice === null ? null : (
          <p aria-live="polite" className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">
            {notice}
          </p>
        )}
        <p className="mt-6 text-sm leading-6 text-[var(--muted)]">{messages.copilot.privacy}</p>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {messages.copilot.form.historyHelp}
        </p>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{messages.copilot.limits}</p>
      </section>

      <section aria-labelledby="conversation-history-title" className="space-y-5">
        <h2 className="text-2xl font-semibold" id="conversation-history-title">
          {messages.copilot.history}
        </h2>
        {conversations.length === 0 ? (
          <p className="rounded-3xl border border-[var(--border)] bg-white p-6 text-[var(--muted)]">
            {messages.copilot.empty}
          </p>
        ) : (
          conversations.map((conversation) => (
            <article className="rounded-3xl border border-[var(--border)] bg-white p-6 sm:p-8" key={conversation.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold">{conversation.title}</h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    <bdi dir="ltr">{conversation.updatedAt}</bdi>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-semibold"
                    onClick={() => setSelectedId(conversation.id)}
                    type="button"
                  >
                    {messages.copilot.actions.continue}
                  </button>
                  <button
                    className="rounded-xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-800"
                    disabled={deletingId !== null}
                    onClick={() => void deleteConversation(conversation)}
                    type="button"
                  >
                    {deletingId === conversation.id
                      ? messages.copilot.actions.deleting
                      : messages.copilot.actions.delete}
                  </button>
                </div>
              </div>
              <ol className="mt-6 space-y-5">
                {conversation.messages.map((message) => (
                  <li key={message.id}>
                    {message.role === "user" ? (
                      <p className="rounded-2xl bg-[var(--foreground)] p-4 text-white">{message.text}</p>
                    ) : (
                      <div className="space-y-3">
                        <ResponseSection evidence={message.evidence} items={message.response.fact} title={messages.copilot.sections.fact} />
                        <ResponseSection evidence={message.evidence} items={message.response.insight} title={messages.copilot.sections.insight} />
                        <ResponseSection evidence={message.evidence} items={message.response.recommendation} title={messages.copilot.sections.recommendation} />
                        <details className="text-sm text-[var(--muted)]">
                          <summary className="cursor-pointer font-semibold">{messages.copilot.usage}</summary>
                          <p className="mt-2">
                            <bdi dir="ltr">{message.provider} · {message.model}</bdi>
                          </p>
                          <p className="mt-1">
                            {messages.copilot.source}: {message.sourceReferences.map((reference) => (
                              <bdi className="me-2" dir="ltr" key={reference.alias}>{reference.kind} · {reference.version}</bdi>
                            ))}
                          </p>
                        </details>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

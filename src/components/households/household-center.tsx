"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type FormEvent } from "react";

import type {
  CreatedHouseholdInvitationView,
  HouseholdCenterView,
  HouseholdEligibleResourceView,
} from "@/lib/households/household";
import { appLocale, messages, userFacingErrorMessage } from "@/lib/i18n";
import type { SerializedMoney } from "@/lib/domain/money/money";

function moneyMajor(value: SerializedMoney): string {
  const digits =
    new Intl.NumberFormat(appLocale.intlLocale, {
      currency: value.currency,
      style: "currency",
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const negative = value.amountMinor.startsWith("-");
  const unsigned = negative ? value.amountMinor.slice(1) : value.amountMinor;
  const padded = unsigned.padStart(digits + 1, "0");
  return `${negative ? "-" : ""}${
    digits === 0 ? padded : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`
  }`;
}

function MoneyValue({ value }: Readonly<{ value: SerializedMoney }>) {
  return (
    <bdi className="break-all tabular-nums" dir="ltr">
      {moneyMajor(value)} {value.currency}
    </bdi>
  );
}

async function requestJson<T>(
  url: string,
  method: "DELETE" | "PATCH" | "POST",
  body: unknown,
): Promise<T> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(userFacingErrorMessage(payload, messages.households.failure));
  }
  return payload as T;
}

function resourceKindLabel(resource: HouseholdEligibleResourceView) {
  return messages.households.resources[resource.resourceKind];
}

function reloadSelected(householdId?: string) {
  window.location.assign(
    householdId === undefined
      ? "/households"
      : `/households?household=${encodeURIComponent(householdId)}`,
  );
}

function subscribeToInviteFragment(callback: () => void): () => void {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function inviteFragmentSnapshot(): string {
  return /^#invite=([A-Za-z0-9_-]+)$/.exec(window.location.hash)?.[1] ?? "";
}

export function HouseholdCenter({ initialView }: Readonly<{ initialView: HouseholdCenterView }>) {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [enteredInvitationToken, setEnteredInvitationToken] = useState("");
  const [oneTimeLink, setOneTimeLink] = useState("");
  const fragmentInvitationToken = useSyncExternalStore(
    subscribeToInviteFragment,
    inviteFragmentSnapshot,
    () => "",
  );
  const invitationToken = enteredInvitationToken || fragmentInvitationToken;
  const selected = initialView.selected;
  const currentMember = initialView.members.find((member) => member.isCurrentActor);

  async function run(action: () => Promise<void>) {
    setWorking(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : messages.households.failure);
      setWorking(false);
    }
  }

  async function createHousehold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = new FormData(form).get("name");
    await run(async () => {
      const response = await requestJson<{ household: { id: string } }>(
        "/api/households",
        "POST",
        { idempotencyKey: crypto.randomUUID(), name },
      );
      setMessage(messages.households.status.created);
      reloadSelected(response.household.id);
    });
  }

  async function acceptInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const response = await requestJson<{ household: { id: string } }>(
        "/api/households/invitations/accept",
        "POST",
        { token: invitationToken },
      );
      window.history.replaceState(null, "", "/households");
      setMessage(messages.households.status.accepted);
      reloadSelected(response.household.id);
    });
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected === null) return;
    const form = event.currentTarget;
    const email = new FormData(form).get("email");
    await run(async () => {
      const response = await requestJson<CreatedHouseholdInvitationView>(
        `/api/households/${selected.id}/invitations`,
        "POST",
        { email },
      );
      const link = `${window.location.origin}/households#invite=${encodeURIComponent(response.token)}`;
      setOneTimeLink(link);
      setMessage(messages.households.status.invitationCreated);
      setWorking(false);
      form.reset();
    });
  }

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected === null) return;
    const name = new FormData(event.currentTarget).get("name");
    await run(async () => {
      await requestJson(`/api/households/${selected.id}`, "PATCH", {
        expectedVersion: selected.version,
        name,
      });
      reloadSelected(selected.id);
    });
  }

  async function changeShare(resource: HouseholdEligibleResourceView) {
    if (selected === null) return;
    await run(async () => {
      await requestJson(`/api/households/${selected.id}/shares`, "POST", {
        action: resource.shared ? "unshare" : "share",
        expectedVersion: resource.shareVersion,
        resourceId: resource.resourceId,
        resourceKind: resource.resourceKind,
      });
      reloadSelected(selected.id);
    });
  }

  async function revokeInvitation(invitationId: string, version: number) {
    if (selected === null) return;
    await run(async () => {
      await requestJson(
        `/api/households/${selected.id}/invitations/${invitationId}`,
        "DELETE",
        { expectedVersion: version },
      );
      reloadSelected(selected.id);
    });
  }

  async function removeMember(membershipId: string, version: number) {
    if (selected === null) return;
    await run(async () => {
      await requestJson(
        `/api/households/${selected.id}/members/${membershipId}`,
        "DELETE",
        { expectedVersion: version },
      );
      reloadSelected(selected.id);
    });
  }

  async function leave() {
    if (selected === null || currentMember === undefined) return;
    if (!window.confirm(messages.households.actions.leave)) return;
    await run(async () => {
      await requestJson(`/api/households/${selected.id}/leave`, "POST", {
        expectedVersion: currentMember.version,
      });
      reloadSelected();
    });
  }

  async function dissolve() {
    if (selected === null) return;
    if (!window.confirm(messages.households.settings.description)) return;
    await run(async () => {
      await requestJson(`/api/households/${selected.id}`, "DELETE", {
        expectedVersion: selected.version,
      });
      reloadSelected();
    });
  }

  return (
    <div className="mt-8 space-y-8">
      <p className="rounded-3xl border border-[var(--border)] bg-white p-6 leading-7 text-[var(--muted)]">
        {messages.households.privacy}
      </p>

      <p className="font-semibold" role="status" aria-live="polite">
        {message}
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-2xl font-semibold">{messages.households.create.title}</h2>
          <p className="mt-3 leading-7 text-[var(--muted)]">
            {messages.households.create.description}
          </p>
          <form className="mt-5 space-y-4" onSubmit={(event) => void createHousehold(event)}>
            <label className="block font-semibold">
              {messages.households.create.name}
              <input
                className="mt-2 w-full rounded-xl border border-[var(--border)] px-4 py-3"
                maxLength={100}
                name="name"
                required
              />
            </label>
            <button
              className="rounded-xl bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-60"
              disabled={working}
              type="submit"
            >
              {working ? messages.households.actions.creating : messages.households.actions.create}
            </button>
          </form>
        </section>

        <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-2xl font-semibold">{messages.households.invitations.acceptTitle}</h2>
          <p className="mt-3 leading-7 text-[var(--muted)]">
            {messages.households.invitations.acceptDescription}
          </p>
          <form className="mt-5 space-y-4" onSubmit={(event) => void acceptInvitation(event)}>
            <label className="block font-semibold">
              {messages.households.invitations.token}
              <input
                className="mt-2 w-full rounded-xl border border-[var(--border)] px-4 py-3 font-mono"
                dir="ltr"
                maxLength={128}
                onChange={(event) => setEnteredInvitationToken(event.target.value.trim())}
                required
                value={invitationToken}
              />
            </label>
            <button
              className="rounded-xl border border-[var(--accent)] px-4 py-3 font-semibold text-[var(--accent)] disabled:opacity-60"
              disabled={working}
              type="submit"
            >
              {messages.households.actions.acceptInvitation}
            </button>
          </form>
        </section>
      </div>

      {initialView.households.length === 0 ? (
        <p className="rounded-3xl border border-[var(--border)] bg-white p-6 text-[var(--muted)]">
          {messages.households.empty}
        </p>
      ) : (
        <nav aria-label={messages.households.title} className="flex flex-wrap gap-3">
          {initialView.households.map((household) => (
            <Link
              className={`rounded-full border px-4 py-2 font-semibold ${
                household.id === selected?.id
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-[var(--border)]"
              }`}
              href={`/households?household=${household.id}`}
              key={household.id}
            >
              {household.name}
            </Link>
          ))}
        </nav>
      )}

      {selected === null ? null : (
        <>
          <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
            <h2 className="text-2xl font-semibold">{selected.name}</h2>
            <p className="mt-2 text-[var(--muted)]">
              {messages.households.members[selected.role]} · {selected.memberCount}
            </p>
            <h3 className="mt-6 text-xl font-semibold">{messages.households.members.title}</h3>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {initialView.members.map((member) => (
                <li className="rounded-2xl bg-[var(--background)] p-4" key={`${member.role}-${member.membershipId ?? "owner"}`}>
                  <p className="font-semibold">{member.displayName}</p>
                  <p className="text-sm text-[var(--muted)]">{messages.households.members[member.role]}</p>
                  <bdi className="text-sm text-[var(--muted)]" dir="ltr">{member.joinedAt}</bdi>
                  {selected.role === "owner" && member.role === "member" && member.membershipId !== null ? (
                    <button
                      className="mt-3 block text-sm font-semibold text-red-700 disabled:opacity-60"
                      disabled={working}
                      onClick={() => void removeMember(member.membershipId!, member.version)}
                      type="button"
                    >
                      {messages.households.actions.remove}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          {selected.role === "owner" ? (
            <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
              <h2 className="text-2xl font-semibold">{messages.households.invitations.title}</h2>
              <form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => void createInvitation(event)}>
                <label className="flex-1 font-semibold">
                  {messages.households.invitations.email}
                  <input className="mt-2 w-full rounded-xl border border-[var(--border)] px-4 py-3" dir="ltr" name="email" required type="email" />
                </label>
                <button className="self-end rounded-xl bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-60" disabled={working} type="submit">
                  {working ? messages.households.actions.inviting : messages.households.actions.invite}
                </button>
              </form>
              {oneTimeLink.length === 0 ? null : (
                <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                  <p className="font-semibold">{messages.households.invitations.oneTimeLink}</p>
                  <input className="mt-2 w-full bg-transparent font-mono text-sm" dir="ltr" readOnly value={oneTimeLink} />
                </div>
              )}
              {initialView.invitations.length === 0 ? (
                <p className="mt-4 text-[var(--muted)]">{messages.households.invitations.empty}</p>
              ) : (
                <ul className="mt-5 space-y-3">
                  {initialView.invitations.map((invitation) => (
                    <li className="rounded-2xl bg-[var(--background)] p-4" key={invitation.id}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <bdi dir="ltr">{invitation.inviteeHint}</bdi>
                          <p className="text-sm text-[var(--muted)]">{messages.households.invitations[invitation.status]}</p>
                          <p className="text-sm text-[var(--muted)]">{messages.households.invitations.expires}: <bdi dir="ltr">{invitation.expiresAt}</bdi></p>
                        </div>
                        {invitation.status === "pending" ? (
                          <button className="font-semibold text-red-700 disabled:opacity-60" disabled={working} onClick={() => void revokeInvitation(invitation.id, invitation.version)} type="button">
                            {messages.households.actions.revoke}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
            <h2 className="text-2xl font-semibold">{messages.households.resources.title}</h2>
            {initialView.eligibleResources.length === 0 ? (
              <p className="mt-4 text-[var(--muted)]">{messages.households.resources.empty}</p>
            ) : (
              <ul className="mt-5 grid gap-4 sm:grid-cols-2">
                {initialView.eligibleResources.map((resource) => (
                  <li className="rounded-2xl bg-[var(--background)] p-4" key={`${resource.resourceKind}-${resource.resourceId}`}>
                    <p className="text-sm text-[var(--muted)]">{resourceKindLabel(resource)}</p>
                    <p className="font-semibold">{resource.label}</p>
                    <button className="mt-3 font-semibold text-[var(--accent)] disabled:opacity-60" disabled={working} onClick={() => void changeShare(resource)} type="button">
                      {resource.shared ? messages.households.actions.unshare : messages.households.actions.share}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
            <h2 className="text-2xl font-semibold">{messages.households.shared.summary}</h2>
            <h3 className="mt-6 text-xl font-semibold">{messages.households.shared.total}</h3>
            <ul className="mt-3 flex flex-wrap gap-4">
              {initialView.totals.map((total) => (
                <li className="rounded-2xl bg-[var(--background)] p-4" key={total.amount.currency}>
                  <MoneyValue value={total.amount} /> · <bdi dir="ltr">{total.contributionCount}</bdi>
                </li>
              ))}
            </ul>
            <h3 className="mt-6 text-xl font-semibold">{messages.households.shared.accounts}</h3>
            {initialView.sharedAccounts.length === 0 ? <p className="mt-3 text-[var(--muted)]">{messages.households.shared.emptyAccounts}</p> : (
              <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                {initialView.sharedAccounts.map((account) => (
                  <li className="rounded-2xl bg-[var(--background)] p-4" key={account.provenanceAlias}>
                    <p className="font-semibold">{account.label}</p>
                    <p className="text-sm text-[var(--muted)]">{messages.households.shared.owner}: {account.ownerLabel}</p>
                    <MoneyValue value={account.balance} />
                    <p className="text-xs text-[var(--muted)]">{messages.households.shared.provenance}: <bdi dir="ltr">{account.provenanceAlias}</bdi></p>
                  </li>
                ))}
              </ul>
            )}
            <h3 className="mt-6 text-xl font-semibold">{messages.households.shared.goals}</h3>
            {initialView.sharedGoals.length === 0 ? <p className="mt-3 text-[var(--muted)]">{messages.households.shared.emptyGoals}</p> : (
              <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                {initialView.sharedGoals.map((goal) => (
                  <li className="rounded-2xl bg-[var(--background)] p-4" key={goal.provenanceAlias}>
                    <p className="font-semibold">{goal.label}</p>
                    <p className="text-sm text-[var(--muted)]">{messages.households.shared.owner}: {goal.ownerLabel}</p>
                    <p>{goal.currentValue === null ? "—" : <MoneyValue value={goal.currentValue} />} / <MoneyValue value={goal.targetValue} /></p>
                    <p><bdi dir="ltr">{goal.normalizedProgressBasisPoints === null ? "—" : `${goal.normalizedProgressBasisPoints / 100}%`}</bdi></p>
                    <p className="text-xs text-[var(--muted)]">{messages.households.shared.provenance}: <bdi dir="ltr">{goal.provenanceAlias}</bdi></p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
            <h2 className="text-2xl font-semibold">{messages.households.audit.title}</h2>
            {initialView.audit.length === 0 ? <p className="mt-3 text-[var(--muted)]">{messages.households.audit.empty}</p> : (
              <ol className="mt-5 space-y-3">
                {initialView.audit.map((event, index) => (
                  <li className="rounded-2xl bg-[var(--background)] p-4" key={`${event.at}-${index}`}>
                    <p className="font-semibold">{messages.households.audit.actions[event.action]}</p>
                    <p>{event.actorLabel}{event.targetLabel === null ? "" : ` · ${event.targetLabel}`}</p>
                    {event.resourceLabel === null ? null : (
                      <p className="text-sm text-[var(--muted)]">{event.resourceLabel}</p>
                    )}
                    <bdi className="text-sm text-[var(--muted)]" dir="ltr">{event.at}</bdi>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
            <h2 className="text-2xl font-semibold">{messages.households.settings.title}</h2>
            {selected.role === "owner" ? (
              <>
                <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => void rename(event)}>
                  <input className="flex-1 rounded-xl border border-[var(--border)] px-4 py-3" defaultValue={selected.name} maxLength={100} name="name" required />
                  <button className="rounded-xl border border-[var(--accent)] px-4 py-3 font-semibold text-[var(--accent)] disabled:opacity-60" disabled={working} type="submit">{messages.households.actions.rename}</button>
                </form>
                <p className="mt-5 leading-7 text-[var(--muted)]">{messages.households.settings.description}</p>
                <button className="mt-3 font-semibold text-red-700 disabled:opacity-60" disabled={working} onClick={() => void dissolve()} type="button">{messages.households.actions.dissolve}</button>
              </>
            ) : (
              <button className="mt-4 font-semibold text-red-700 disabled:opacity-60" disabled={working} onClick={() => void leave()} type="button">{messages.households.actions.leave}</button>
            )}
          </section>
        </>
      )}
    </div>
  );
}

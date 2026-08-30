"use client";

import { useState, type FormEvent } from "react";

import { messages, userFacingErrorMessage } from "@/lib/i18n";
import type {
  HouseholdType,
  UserProfileView,
} from "@/lib/profiles/profile";

type ProfileFormProps = Readonly<{
  continuePath: string;
  initialProfile: UserProfileView | null;
}>;

type ProfileResponse = Readonly<{
  profile: UserProfileView;
}>;

const householdOptions: readonly Readonly<{
  label: string;
  value: HouseholdType;
}>[] = [
  { label: messages.onboarding.profile.form.householdOptions.single, value: "single" },
  { label: messages.onboarding.profile.form.householdOptions.couple, value: "couple" },
  { label: messages.onboarding.profile.form.householdOptions.family, value: "family" },
  { label: messages.onboarding.profile.form.householdOptions.other, value: "other" },
];

export function ProfileForm({ continuePath, initialProfile }: ProfileFormProps) {
  const [displayName, setDisplayName] = useState(initialProfile?.displayName ?? "");
  const [countryCode, setCountryCode] = useState(
    initialProfile?.countryCode ?? "",
  );
  const [primaryCurrency, setPrimaryCurrency] = useState(
    initialProfile?.primaryCurrency ?? "",
  );
  const [timeZone, setTimeZone] = useState(
    initialProfile?.timeZone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      "",
  );
  const [householdType, setHouseholdType] = useState<HouseholdType>(
    initialProfile?.householdType ?? "single",
  );
  const [version, setVersion] = useState<number | null>(
    initialProfile?.version ?? null,
  );
  const [status, setStatus] = useState<
    | Readonly<{ kind: "error"; message: string }>
    | Readonly<{ kind: "idle"; message: "" }>
    | Readonly<{ kind: "saved"; message: string }>
    | Readonly<{ kind: "saving"; message: string }>
  >({ kind: "idle", message: "" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "saving", message: messages.onboarding.profile.form.saving });

    try {
      const response = await fetch("/api/profile", {
        body: JSON.stringify({
          countryCode: countryCode.trim().toUpperCase(),
          displayName: displayName.trim(),
          expectedVersion: version,
          householdType,
          primaryCurrency: primaryCurrency.trim().toUpperCase(),
          timeZone: timeZone.trim(),
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PUT",
      });

      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(
          userFacingErrorMessage(payload, messages.errors.profileSave),
        );
      }

      const saved = payload as ProfileResponse;
      setVersion(saved.profile.version);
      setStatus({
        kind: "saved",
        message: messages.onboarding.profile.form.saved,
      });
      window.location.assign(continuePath);
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : messages.errors.profileSave,
      });
    }
  }

  return (
    <form className="mt-8 space-y-6" onSubmit={submit}>
      <div>
        <label className="text-sm font-semibold" htmlFor="displayName">
          {messages.onboarding.profile.form.name}
        </label>
        <input
          autoComplete="name"
          className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 outline-none transition focus:border-[var(--accent)]"
          id="displayName"
          maxLength={80}
          onChange={(event) => setDisplayName(event.target.value)}
          required
          value={displayName}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label className="text-sm font-semibold" htmlFor="countryCode">
            {messages.onboarding.profile.form.countryCode}
          </label>
          <input
            autoCapitalize="characters"
            className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 uppercase outline-none transition focus:border-[var(--accent)]"
            id="countryCode"
            dir="ltr"
            maxLength={2}
            onChange={(event) => setCountryCode(event.target.value)}
            placeholder="IL"
            required
            value={countryCode}
          />
        </div>

        <div>
          <label className="text-sm font-semibold" htmlFor="primaryCurrency">
            {messages.onboarding.profile.form.currency}
          </label>
          <input
            autoCapitalize="characters"
            className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 uppercase outline-none transition focus:border-[var(--accent)]"
            id="primaryCurrency"
            dir="ltr"
            maxLength={3}
            onChange={(event) => setPrimaryCurrency(event.target.value)}
            placeholder="ILS"
            required
            value={primaryCurrency}
          />
        </div>
      </div>

      <div>
        <label className="text-sm font-semibold" htmlFor="timeZone">
          {messages.onboarding.profile.form.timeZone}
        </label>
        <input
          className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 outline-none transition focus:border-[var(--accent)]"
          id="timeZone"
          dir="ltr"
          onChange={(event) => setTimeZone(event.target.value)}
          placeholder="Asia/Jerusalem"
          required
          value={timeZone}
        />
        <p className="mt-2 text-sm text-[var(--muted)]">
          {messages.onboarding.profile.form.timeZoneHelp}
        </p>
      </div>

      <div>
        <label className="text-sm font-semibold" htmlFor="householdType">
          {messages.onboarding.profile.form.household}
        </label>
        <select
          className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 outline-none transition focus:border-[var(--accent)]"
          id="householdType"
          onChange={(event) =>
            setHouseholdType(event.target.value as HouseholdType)
          }
          value={householdType}
        >
          {householdOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <button
        className="w-full rounded-2xl bg-[var(--accent)] px-5 py-3.5 font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={status.kind === "saving"}
        type="submit"
      >
        {status.kind === "saving"
          ? messages.onboarding.profile.form.saving
          : messages.onboarding.profile.form.save}
      </button>

      <p
        aria-live="polite"
        className={
          status.kind === "error"
            ? "text-sm text-red-700"
            : "text-sm text-[var(--muted)]"
        }
      >
        {status.message}
      </p>
    </form>
  );
}

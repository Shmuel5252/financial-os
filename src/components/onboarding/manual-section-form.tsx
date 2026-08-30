"use client";

import {
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

import type {
  ManualRecordView,
  ManualSection,
  SerializedDomainValue,
} from "@/lib/onboarding/manual-record";
import type { OnboardingStep } from "@/lib/profiles/profile";

type ManualSectionFormProps = Readonly<{
  canComplete: boolean;
  currency: string;
  initialRecords: readonly ManualRecordView[];
  nextPath: string;
  profileVersion: number;
  section: ManualSection;
  step: OnboardingStep;
}>;

type RecordResponse = Readonly<{ record: ManualRecordView }>;
type ErrorResponse = Readonly<{
  error?: Readonly<{ message?: string }>;
}>;

function value(form: FormData, name: string): string {
  const entry = form.get(name);
  return typeof entry === "string" ? entry.trim() : "";
}

function integer(form: FormData, name: string): number {
  return Number.parseInt(value(form, name), 10);
}

function percentageToBasisPoints(input: string): number {
  if (!/^(0|[1-9]\d{0,2})(\.\d{1,2})?$/.test(input)) {
    throw new Error("Use a percentage with at most two decimal places.");
  }

  const [whole = "0", fraction = ""] = input.split(".");
  const basisPoints = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));

  if (basisPoints > 10_000n) {
    throw new Error("Percentage cannot exceed 100%.");
  }

  return Number(basisPoints);
}

function moneyInput(form: FormData, name: string, currency: string) {
  return {
    amount: value(form, name),
    currency,
  };
}

function buildFields(
  section: ManualSection,
  form: FormData,
  currency: string,
): unknown {
  switch (section) {
    case "income":
      return {
        amount: moneyInput(form, "amount", currency),
        certaintyBps: percentageToBasisPoints(value(form, "certainty")),
        destination: value(form, "destination"),
        expectedDate: value(form, "expectedDate"),
        frequency: value(form, "frequency"),
        name: value(form, "name"),
      };
    case "accounts":
      return {
        balance: moneyInput(form, "balance", currency),
        name: value(form, "name"),
        type: value(form, "type"),
      };
    case "cards":
      return {
        billingDay: integer(form, "billingDay"),
        issuer: value(form, "issuer"),
        limit: moneyInput(form, "limit", currency),
        name: value(form, "name"),
        used: moneyInput(form, "used", currency),
      };
    case "expenses":
      return {
        amount: moneyInput(form, "amount", currency),
        category: value(form, "category"),
        frequency: value(form, "frequency"),
        name: value(form, "name"),
        nextDueDate: value(form, "nextDueDate"),
      };
    case "loans":
      return {
        annualInterestRateBps: percentageToBasisPoints(
          value(form, "annualInterestRate"),
        ),
        endDate: value(form, "endDate") || null,
        monthlyPayment: moneyInput(form, "monthlyPayment", currency),
        name: value(form, "name"),
        nextPaymentDate: value(form, "nextPaymentDate"),
        originalAmount: moneyInput(form, "originalAmount", currency),
        remainingBalance: moneyInput(form, "remainingBalance", currency),
      };
    case "safety_margin":
      return value(form, "kind") === "income_percentage"
        ? {
            basisPoints: percentageToBasisPoints(value(form, "percentage")),
            kind: "income_percentage",
          }
        : {
            amount: moneyInput(form, "amount", currency),
            kind: "fixed",
          };
    case "goals":
      return {
        currentValue: moneyInput(form, "currentValue", currency),
        priority: integer(form, "priority"),
        startingValue: moneyInput(form, "startingValue", currency),
        targetAmount: moneyInput(form, "targetAmount", currency),
        targetDate: value(form, "targetDate") || null,
        title: value(form, "title"),
        type: value(form, "type"),
      };
  }
}

function Field({
  label,
  name,
  ...props
}: Readonly<
  {
    label: string;
    name: string;
  } & Omit<InputHTMLAttributes<HTMLInputElement>, "name">
>) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <input
        {...props}
        className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 font-normal outline-none transition focus:border-[var(--accent)]"
        name={name}
      />
    </label>
  );
}

function SelectField({
  children,
  label,
  name,
}: Readonly<{
  children: ReactNode;
  label: string;
  name: string;
}>) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <select
        className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 font-normal outline-none transition focus:border-[var(--accent)]"
        name={name}
      >
        {children}
      </select>
    </label>
  );
}

function FormFields({
  currency,
  section,
}: Readonly<{ currency: string; section: ManualSection }>) {
  const [safetyKind, setSafetyKind] = useState("fixed");

  switch (section) {
    case "income":
      return (
        <>
          <Field label="Income name" name="name" required />
          <Field label={`Amount (${currency})`} name="amount" required />
          <Field label="Expected date" name="expectedDate" required type="date" />
          <SelectField label="Frequency" name="frequency">
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every two weeks</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
            <option value="one_time">One-time</option>
            <option value="irregular">Irregular</option>
          </SelectField>
          <Field
            defaultValue="100"
            label="Certainty (%)"
            max="100"
            min="0"
            name="certainty"
            required
          />
          <SelectField label="Destination" name="destination">
            <option value="bank_account">Bank account</option>
            <option value="cash">Cash</option>
            <option value="savings">Savings</option>
            <option value="investments">Investments</option>
          </SelectField>
        </>
      );
    case "accounts":
      return (
        <>
          <Field label="Account name" name="name" required />
          <SelectField label="Account type" name="type">
            <option value="bank">Bank</option>
            <option value="cash">Cash</option>
            <option value="savings">Savings</option>
            <option value="investments">Investments</option>
          </SelectField>
          <Field label={`Current balance (${currency})`} name="balance" required />
        </>
      );
    case "cards":
      return (
        <>
          <Field label="Card name" name="name" required />
          <Field label="Issuer" name="issuer" required />
          <Field label={`Credit limit (${currency})`} name="limit" required />
          <Field label={`Currently used (${currency})`} name="used" required />
          <Field
            label="Billing day"
            max="31"
            min="1"
            name="billingDay"
            required
            type="number"
          />
        </>
      );
    case "expenses":
      return (
        <>
          <Field label="Expense name" name="name" required />
          <Field label={`Amount (${currency})`} name="amount" required />
          <SelectField label="Category" name="category">
            {[
              "housing",
              "utilities",
              "insurance",
              "communications",
              "children",
              "subscriptions",
              "transport",
              "food",
              "debt_payment",
              "other",
            ].map((category) => (
              <option key={category} value={category}>
                {category.replaceAll("_", " ")}
              </option>
            ))}
          </SelectField>
          <SelectField label="Frequency" name="frequency">
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
            <option value="irregular">Irregular</option>
          </SelectField>
          <Field label="Next due date" name="nextDueDate" required type="date" />
        </>
      );
    case "loans":
      return (
        <>
          <Field label="Loan name" name="name" required />
          <Field
            label={`Original amount (${currency})`}
            name="originalAmount"
            required
          />
          <Field
            label={`Remaining balance (${currency})`}
            name="remainingBalance"
            required
          />
          <Field
            label={`Monthly payment (${currency})`}
            name="monthlyPayment"
            required
          />
          <Field
            defaultValue="0"
            label="Annual interest rate (%)"
            name="annualInterestRate"
            required
          />
          <Field
            label="Next payment date"
            name="nextPaymentDate"
            required
            type="date"
          />
          <Field label="End date (optional)" name="endDate" type="date" />
        </>
      );
    case "safety_margin":
      return (
        <>
          <label className="block text-sm font-semibold">
            Safety margin type
            <select
              className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 font-normal"
              name="kind"
              onChange={(event) => setSafetyKind(event.target.value)}
              value={safetyKind}
            >
              <option value="fixed">Fixed amount</option>
              <option value="income_percentage">Percentage of income</option>
            </select>
          </label>
          {safetyKind === "fixed" ? (
            <Field label={`Amount (${currency})`} name="amount" required />
          ) : (
            <Field
              label="Income percentage (%)"
              max="100"
              min="0"
              name="percentage"
              required
            />
          )}
        </>
      );
    case "goals":
      return (
        <>
          <Field label="Goal title" name="title" required />
          <SelectField label="Goal type" name="type">
            <option value="debt_free">Become debt-free</option>
            <option value="no_overdraft">End overdraft</option>
            <option value="no_credit_dependency">End credit dependency</option>
            <option value="emergency_fund">Build emergency fund</option>
            <option value="savings_target">Savings target</option>
            <option value="monthly_spending">Monthly spending target</option>
            <option value="custom">Custom</option>
          </SelectField>
          <Field
            label={`Target amount (${currency})`}
            name="targetAmount"
            required
          />
          <Field
            defaultValue="0"
            label={`Starting value (${currency})`}
            name="startingValue"
            required
          />
          <Field
            defaultValue="0"
            label={`Current value (${currency})`}
            name="currentValue"
            required
          />
          <Field label="Target date (optional)" name="targetDate" type="date" />
          <Field
            defaultValue="3"
            label="Priority (1–5)"
            max="5"
            min="1"
            name="priority"
            required
            type="number"
          />
        </>
      );
  }
}

function asObject(
  value: SerializedDomainValue,
): Readonly<Record<string, SerializedDomainValue>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Readonly<Record<string, SerializedDomainValue>>;
}

function recordLabel(record: ManualRecordView): string {
  const fields = asObject(record.fields);
  const name = fields.name ?? fields.title;

  if (typeof name === "string") {
    return name;
  }

  return record.section === "safety_margin" ? "Safety margin" : "Manual record";
}

function firstMoneySummary(value: SerializedDomainValue): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    const object = value as Readonly<Record<string, SerializedDomainValue>>;
    const amountMinor = object.amountMinor;
    const currency = object.currency;

    if (typeof amountMinor === "string" && typeof currency === "string") {
      const digits =
        new Intl.NumberFormat("en", {
          currency,
          style: "currency",
        }).resolvedOptions().maximumFractionDigits ?? 2;
      const negative = amountMinor.startsWith("-");
      const unsigned = negative ? amountMinor.slice(1) : amountMinor;
      const padded = unsigned.padStart(digits + 1, "0");
      const major =
        digits === 0
          ? padded
          : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
      return `${negative ? "-" : ""}${major} ${currency}`;
    }
  }

  const children = Array.isArray(value) ? value : Object.values(value);

  for (const child of children) {
    const summary = firstMoneySummary(child);
    if (summary !== null) {
      return summary;
    }
  }

  return null;
}

export function ManualSectionForm({
  canComplete,
  currency,
  initialRecords,
  nextPath,
  profileVersion,
  section,
  step,
}: ManualSectionFormProps) {
  const [records, setRecords] = useState([...initialRecords]);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setMessage("");

    try {
      const fields = buildFields(section, new FormData(event.currentTarget), currency);
      const response = await fetch(`/api/onboarding/${section}`, {
        body: JSON.stringify({ fields }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const error = payload as ErrorResponse;
        throw new Error(error.error?.message ?? "The record could not be saved.");
      }

      const result = payload as RecordResponse;
      setRecords((current) => [...current, result.record]);
      event.currentTarget.reset();
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The record could not be saved.");
    } finally {
      setWorking(false);
    }
  }

  async function remove(record: ManualRecordView) {
    setWorking(true);
    setMessage("");

    try {
      const response = await fetch(`/api/onboarding/${section}`, {
        body: JSON.stringify({
          expectedVersion: record.version,
          id: record.id,
        }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const error = payload as ErrorResponse;
        throw new Error(error.error?.message ?? "The record could not be removed.");
      }

      setRecords((current) => current.filter((item) => item.id !== record.id));
      setMessage("Removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The record could not be removed.");
    } finally {
      setWorking(false);
    }
  }

  async function completeSection() {
    setWorking(true);
    setMessage("");

    try {
      const response = await fetch("/api/onboarding/progress", {
        body: JSON.stringify({
          expectedVersion: profileVersion,
          step,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const error = payload as ErrorResponse;
        throw new Error(error.error?.message ?? "The step could not be completed.");
      }

      window.location.assign(nextPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The step could not be completed.");
      setWorking(false);
    }
  }

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_0.8fr]">
      <form
        className="space-y-5 rounded-3xl border border-[var(--border)] bg-white p-6"
        onSubmit={submit}
      >
        <h2 className="text-xl font-semibold">Add a manual record</h2>
        <FormFields currency={currency} section={section} />
        <button
          className="w-full rounded-2xl bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-60"
          disabled={working}
          type="submit"
        >
          Save record
        </button>
      </form>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-xl font-semibold">Saved records</h2>
        {records.length === 0 ? (
          <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
            No records yet. You may explicitly continue with none if this section
            does not apply.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {records.map((record) => (
              <li
                className="flex items-center justify-between gap-4 rounded-2xl bg-[var(--background)] p-4"
                key={record.id}
              >
                <div>
                  <p className="font-semibold">{recordLabel(record)}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {firstMoneySummary(record.fields) ?? "Manual configuration"}
                  </p>
                </div>
                <button
                  className="text-sm font-semibold text-red-700"
                  disabled={working}
                  onClick={() => void remove(record)}
                  type="button"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          className="mt-6 w-full rounded-2xl border border-[var(--accent)] px-5 py-3 font-semibold text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canComplete || working}
          onClick={() => void completeSection()}
          type="button"
        >
          Complete this step
        </button>
        {!canComplete ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            Complete the current onboarding step before advancing this one.
          </p>
        ) : null}
        <p aria-live="polite" className="mt-3 text-sm text-[var(--muted)]">
          {message}
        </p>
      </section>
    </div>
  );
}

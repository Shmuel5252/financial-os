"use client";

import {
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

import type {
  ManualRecordView,
  ManualSection,
  SerializedDomainValue,
} from "@/lib/onboarding/manual-record";
import {
  appLocale,
  messages,
  userFacingErrorMessage,
} from "@/lib/i18n";
import type { OnboardingStep } from "@/lib/profiles/profile";

type ManualSectionFormProps = Readonly<{
  accountOptions?: readonly Readonly<{ id: string; label: string }>[];
  apiBasePath?: "/api/financial-data" | "/api/onboarding";
  canComplete?: boolean;
  currency: string;
  initialRecords: readonly ManualRecordView[];
  initialNextCursor?: string | null;
  nextPath?: string;
  profileVersion?: number;
  section: ManualSection;
  step?: OnboardingStep;
}>;

type RecordResponse = Readonly<{ record: ManualRecordView }>;
type PageResponse = Readonly<{
  nextCursor: string | null;
  records: readonly ManualRecordView[];
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
    throw new Error(messages.errors.percentageFormat);
  }

  const [whole = "0", fraction = ""] = input.split(".");
  const basisPoints = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));

  if (basisPoints > 10_000n) {
    throw new Error(messages.errors.percentageMaximum);
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
    case "transactions":
      return {
        accountId: value(form, "accountId"),
        amount: moneyInput(form, "amount", currency),
        category: value(form, "category"),
        confidenceBps: percentageToBasisPoints(value(form, "confidence")),
        date: value(form, "date"),
        destinationAccountId: value(form, "destinationAccountId") || null,
        merchant: value(form, "merchant") || null,
        notes: value(form, "notes") || null,
        recurring: value(form, "recurring") === "yes",
        type: value(form, "type"),
      };
    case "recurring_transactions":
      return {
        accountId: value(form, "accountId"),
        active: value(form, "active") === "yes",
        amount: moneyInput(form, "amount", currency),
        category: value(form, "category"),
        endDate: value(form, "endDate") || null,
        frequency: value(form, "frequency"),
        interval: integer(form, "interval"),
        merchant: value(form, "merchant") || null,
        name: value(form, "name"),
        nextOccurrenceDate: value(form, "nextOccurrenceDate"),
        startDate: value(form, "startDate"),
        type: value(form, "type"),
      };
    case "savings":
      return {
        accountIdentifierLast4:
          value(form, "accountIdentifierLast4") || null,
        availability: value(form, "availability"),
        balance: moneyInput(form, "balance", currency),
        institution: value(form, "institution") || null,
        maturityDate: value(form, "maturityDate") || null,
        name: value(form, "name"),
      };
  }
}

function Field({
  label,
  name,
  ...props
}: Readonly<
  {
    label: ReactNode;
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
  ...props
}: Readonly<{
  children: ReactNode;
  label: ReactNode;
  name: string;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "name">>) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <select
        {...props}
        className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 font-normal outline-none transition focus:border-[var(--accent)]"
        name={name}
      >
        {children}
      </select>
    </label>
  );
}

function CurrencyLabel({
  currency,
  label,
}: Readonly<{ currency: string; label: string }>) {
  return (
    <>
      {label} (<bdi dir="ltr">{currency}</bdi>)
    </>
  );
}

function FormFields({
  accountOptions = [],
  currency,
  section,
}: Readonly<{
  accountOptions?: readonly Readonly<{ id: string; label: string }>[];
  currency: string;
  section: ManualSection;
}>) {
  const [safetyKind, setSafetyKind] = useState("fixed");
  const [savingsAvailability, setSavingsAvailability] = useState("liquid");
  const [transactionType, setTransactionType] = useState("expense");
  const { fields } = messages.onboarding.form;

  switch (section) {
    case "income":
      return (
        <>
          <Field label={fields.incomeName} name="name" required />
          <Field
            dir="ltr"
            inputMode="decimal"
            label={<CurrencyLabel currency={currency} label={fields.amount} />}
            name="amount"
            required
          />
          <Field
            dir="ltr"
            label={fields.expectedDate}
            name="expectedDate"
            required
            type="date"
          />
          <SelectField label={fields.frequency} name="frequency">
            <option value="monthly">{messages.onboarding.form.frequencies.monthly}</option>
            <option value="weekly">{messages.onboarding.form.frequencies.weekly}</option>
            <option value="biweekly">{messages.onboarding.form.frequencies.biweekly}</option>
            <option value="quarterly">{messages.onboarding.form.frequencies.quarterly}</option>
            <option value="annual">{messages.onboarding.form.frequencies.annual}</option>
            <option value="one_time">{messages.onboarding.form.frequencies.one_time}</option>
            <option value="irregular">{messages.onboarding.form.frequencies.irregular}</option>
          </SelectField>
          <Field
            defaultValue="100"
            dir="ltr"
            inputMode="decimal"
            label={fields.certainty}
            max="100"
            min="0"
            name="certainty"
            required
          />
          <SelectField label={fields.destination} name="destination">
            <option value="bank_account">{messages.onboarding.form.destinations.bank_account}</option>
            <option value="cash">{messages.onboarding.form.destinations.cash}</option>
            <option value="savings">{messages.onboarding.form.destinations.savings}</option>
            <option value="investments">{messages.onboarding.form.destinations.investments}</option>
          </SelectField>
        </>
      );
    case "accounts":
      return (
        <>
          <Field label={fields.accountName} name="name" required />
          <SelectField label={fields.accountType} name="type">
            <option value="bank">{messages.onboarding.form.accountTypes.bank}</option>
            <option value="cash">{messages.onboarding.form.accountTypes.cash}</option>
            <option value="savings">{messages.onboarding.form.accountTypes.savings}</option>
            <option value="investments">{messages.onboarding.form.accountTypes.investments}</option>
          </SelectField>
          <Field
            dir="ltr"
            inputMode="decimal"
            label={<CurrencyLabel currency={currency} label={fields.currentBalance} />}
            name="balance"
            required
          />
        </>
      );
    case "cards":
      return (
        <>
          <Field label={fields.cardName} name="name" required />
          <Field label={fields.issuer} name="issuer" required />
          <Field
            dir="ltr"
            inputMode="decimal"
            label={<CurrencyLabel currency={currency} label={fields.limit} />}
            name="limit"
            required
          />
          <Field
            dir="ltr"
            inputMode="decimal"
            label={<CurrencyLabel currency={currency} label={fields.currentlyUsed} />}
            name="used"
            required
          />
          <Field
            dir="ltr"
            label={fields.billingDay}
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
          <Field label={fields.expenseName} name="name" required />
          <Field
            dir="ltr"
            inputMode="decimal"
            label={<CurrencyLabel currency={currency} label={fields.amount} />}
            name="amount"
            required
          />
          <SelectField label={fields.category} name="category">
            {(Object.keys(messages.onboarding.form.categories) as Array<keyof typeof messages.onboarding.form.categories>).map((category) => (
              <option key={category} value={category}>
                {messages.onboarding.form.categories[category]}
              </option>
            ))}
          </SelectField>
          <SelectField label={fields.frequency} name="frequency">
            <option value="monthly">{messages.onboarding.form.frequencies.monthly}</option>
            <option value="weekly">{messages.onboarding.form.frequencies.weekly}</option>
            <option value="quarterly">{messages.onboarding.form.frequencies.quarterly}</option>
            <option value="annual">{messages.onboarding.form.frequencies.annual}</option>
            <option value="irregular">{messages.onboarding.form.frequencies.irregular}</option>
          </SelectField>
          <Field
            dir="ltr"
            label={fields.nextDueDate}
            name="nextDueDate"
            required
            type="date"
          />
        </>
      );
    case "loans":
      return (
        <>
          <Field label={fields.loanName} name="name" required />
          <Field
            dir="ltr"
            inputMode="decimal"
            label={<CurrencyLabel currency={currency} label={fields.originalAmount} />}
            name="originalAmount"
            required
          />
          <Field
            dir="ltr"
            inputMode="decimal"
            label={<CurrencyLabel currency={currency} label={fields.remainingBalance} />}
            name="remainingBalance"
            required
          />
          <Field
            dir="ltr"
            inputMode="decimal"
            label={<CurrencyLabel currency={currency} label={fields.monthlyPayment} />}
            name="monthlyPayment"
            required
          />
          <Field
            defaultValue="0"
            dir="ltr"
            inputMode="decimal"
            label={fields.annualInterestRate}
            name="annualInterestRate"
            required
          />
          <Field
            dir="ltr"
            label={fields.nextPaymentDate}
            name="nextPaymentDate"
            required
            type="date"
          />
          <Field
            dir="ltr"
            label={fields.endDateOptional}
            name="endDate"
            type="date"
          />
        </>
      );
    case "safety_margin":
      return (
        <>
          <label className="block text-sm font-semibold">
            {fields.safetyMarginType}
            <select
              className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 font-normal"
              name="kind"
              onChange={(event) => setSafetyKind(event.target.value)}
              value={safetyKind}
            >
              <option value="fixed">{messages.onboarding.form.safetyKinds.fixed}</option>
              <option value="income_percentage">{messages.onboarding.form.safetyKinds.income_percentage}</option>
            </select>
          </label>
          {safetyKind === "fixed" ? (
            <Field
              dir="ltr"
              inputMode="decimal"
              label={<CurrencyLabel currency={currency} label={fields.amount} />}
              name="amount"
              required
            />
          ) : (
            <Field
              dir="ltr"
              inputMode="decimal"
              label={fields.incomePercentage}
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
          <Field label={fields.goalTitle} name="title" required />
          <SelectField label={fields.goalType} name="type">
            <option value="debt_free">{messages.onboarding.form.goalTypes.debt_free}</option>
            <option value="no_overdraft">{messages.onboarding.form.goalTypes.no_overdraft}</option>
            <option value="no_credit_dependency">{messages.onboarding.form.goalTypes.no_credit_dependency}</option>
            <option value="emergency_fund">{messages.onboarding.form.goalTypes.emergency_fund}</option>
            <option value="savings_target">{messages.onboarding.form.goalTypes.savings_target}</option>
            <option value="monthly_spending">{messages.onboarding.form.goalTypes.monthly_spending}</option>
            <option value="custom">{messages.onboarding.form.goalTypes.custom}</option>
          </SelectField>
          <Field
            dir="ltr"
            inputMode="decimal"
            label={<CurrencyLabel currency={currency} label={fields.targetAmount} />}
            name="targetAmount"
            required
          />
          <Field
            defaultValue="0"
            dir="ltr"
            inputMode="decimal"
            label={<CurrencyLabel currency={currency} label={fields.startingValue} />}
            name="startingValue"
            required
          />
          <Field
            defaultValue="0"
            dir="ltr"
            inputMode="decimal"
            label={<CurrencyLabel currency={currency} label={fields.currentValue} />}
            name="currentValue"
            required
          />
          <Field
            dir="ltr"
            label={fields.targetDateOptional}
            name="targetDate"
            type="date"
          />
          <Field
            defaultValue="3"
            dir="ltr"
            label={fields.priority}
            max="5"
            min="1"
            name="priority"
            required
            type="number"
          />
        </>
      );
    case "transactions":
      return (
        <>
          <SelectField
            label={messages.financialData.form.fields.sourceAccount}
            name="accountId"
            required
          >
            <option value="">
              {messages.financialData.form.options.chooseAccount}
            </option>
            {accountOptions.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={messages.financialData.form.fields.transactionType}
            name="type"
            onChange={(event) => setTransactionType(event.target.value)}
            value={transactionType}
          >
            <option value="expense">{messages.financialData.form.options.expense}</option>
            <option value="income">{messages.financialData.form.options.income}</option>
            <option value="transfer">{messages.financialData.form.options.transfer}</option>
          </SelectField>
          {transactionType === "transfer" ? (
            <SelectField
              label={messages.financialData.form.fields.destinationAccount}
              name="destinationAccountId"
              required
            >
              <option value="">
                {messages.financialData.form.options.chooseAccount}
              </option>
              {accountOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </SelectField>
          ) : null}
          <Field
            dir="ltr"
            inputMode="decimal"
            label={<CurrencyLabel currency={currency} label={fields.amount} />}
            name="amount"
            required
          />
          <Field
            dir="ltr"
            label={messages.financialData.form.fields.transactionDate}
            name="date"
            required
            type="date"
          />
          <SelectField label={fields.category} name="category">
            {(Object.keys(messages.onboarding.form.categories) as Array<keyof typeof messages.onboarding.form.categories>).map((category) => (
              <option key={category} value={category}>
                {messages.onboarding.form.categories[category]}
              </option>
            ))}
          </SelectField>
          <Field
            label={messages.financialData.form.fields.merchantOptional}
            maxLength={120}
            name="merchant"
          />
          <Field
            label={messages.financialData.form.fields.notesOptional}
            maxLength={500}
            name="notes"
          />
          <Field
            defaultValue="100"
            dir="ltr"
            inputMode="decimal"
            label={fields.certainty}
            max="100"
            min="0"
            name="confidence"
            required
          />
          <SelectField label={messages.financialData.form.fields.recurring} name="recurring">
            <option value="no">{messages.financialData.form.options.no}</option>
            <option value="yes">{messages.financialData.form.options.yes}</option>
          </SelectField>
        </>
      );
    case "recurring_transactions":
      return (
        <>
          <Field label={messages.financialData.form.fields.definitionName} name="name" required />
          <SelectField label={messages.financialData.form.fields.account} name="accountId" required>
            <option value="">{messages.financialData.form.options.chooseAccount}</option>
            {accountOptions.map((account) => (
              <option key={account.id} value={account.id}>{account.label}</option>
            ))}
          </SelectField>
          <SelectField label={messages.financialData.form.fields.transactionType} name="type">
            <option value="expense">{messages.financialData.form.options.expense}</option>
            <option value="income">{messages.financialData.form.options.income}</option>
          </SelectField>
          <Field
            dir="ltr"
            inputMode="decimal"
            label={<CurrencyLabel currency={currency} label={fields.amount} />}
            name="amount"
            required
          />
          <SelectField label={fields.category} name="category">
            {(Object.keys(messages.onboarding.form.categories) as Array<keyof typeof messages.onboarding.form.categories>).map((category) => (
              <option key={category} value={category}>
                {messages.onboarding.form.categories[category]}
              </option>
            ))}
          </SelectField>
          <SelectField label={fields.frequency} name="frequency">
            <option value="weekly">{messages.onboarding.form.frequencies.weekly}</option>
            <option value="biweekly">{messages.onboarding.form.frequencies.biweekly}</option>
            <option value="monthly">{messages.onboarding.form.frequencies.monthly}</option>
            <option value="quarterly">{messages.onboarding.form.frequencies.quarterly}</option>
            <option value="annual">{messages.onboarding.form.frequencies.annual}</option>
          </SelectField>
          <Field defaultValue="1" dir="ltr" label={messages.financialData.form.fields.interval} max="365" min="1" name="interval" required type="number" />
          <Field dir="ltr" label={messages.financialData.form.fields.startDate} name="startDate" required type="date" />
          <Field dir="ltr" label={messages.financialData.form.fields.nextOccurrenceDate} name="nextOccurrenceDate" required type="date" />
          <Field dir="ltr" label={messages.financialData.form.fields.endDateOptional} name="endDate" type="date" />
          <Field label={messages.financialData.form.fields.merchantOptional} maxLength={120} name="merchant" />
          <SelectField label={messages.financialData.form.fields.active} name="active">
            <option value="yes">{messages.financialData.form.options.yes}</option>
            <option value="no">{messages.financialData.form.options.no}</option>
          </SelectField>
        </>
      );
    case "savings":
      return (
        <>
          <Field label={messages.financialData.form.fields.savingName} name="name" required />
          <Field
            dir="ltr"
            inputMode="decimal"
            label={<CurrencyLabel currency={currency} label={fields.currentBalance} />}
            name="balance"
            required
          />
          <SelectField
            label={messages.financialData.form.fields.availability}
            name="availability"
            onChange={(event) => setSavingsAvailability(event.target.value)}
            value={savingsAvailability}
          >
            <option value="liquid">{messages.financialData.form.options.liquid}</option>
            <option value="fixed_term">{messages.financialData.form.options.fixedTerm}</option>
            <option value="other">{messages.financialData.form.options.other}</option>
          </SelectField>
          {savingsAvailability === "fixed_term" ? (
            <Field dir="ltr" label={messages.financialData.form.fields.maturityDate} name="maturityDate" required type="date" />
          ) : null}
          <Field label={messages.financialData.form.fields.institutionOptional} maxLength={100} name="institution" />
          <Field dir="ltr" inputMode="numeric" label={messages.financialData.form.fields.lastFourOptional} maxLength={4} name="accountIdentifierLast4" pattern="[0-9]{4}" />
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

  return record.section === "safety_margin"
    ? messages.onboarding.sections.safety_margin.label
    : messages.onboarding.form.common.manualRecord;
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
        new Intl.NumberFormat(appLocale.intlLocale, {
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
  accountOptions = [],
  apiBasePath = "/api/onboarding",
  canComplete,
  currency,
  initialRecords,
  initialNextCursor = null,
  nextPath,
  profileVersion,
  section,
  step,
}: ManualSectionFormProps) {
  const [records, setRecords] = useState([...initialRecords]);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setWorking(true);
    setMessage("");

    try {
      const fields = buildFields(section, new FormData(form), currency);
      idempotencyKey.current ??= crypto.randomUUID();
      const response = await fetch(`${apiBasePath}/${section}`, {
        body: JSON.stringify({ fields, idempotencyKey: idempotencyKey.current }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(
          userFacingErrorMessage(payload, messages.errors.recordSave),
        );
      }

      const result = payload as RecordResponse;
      setRecords((current) =>
        apiBasePath === "/api/onboarding"
          ? [...current, result.record]
          : [result.record, ...current],
      );
      idempotencyKey.current = null;
      form.reset();
      setMessage(messages.onboarding.form.saved);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : messages.errors.recordSave,
      );
    } finally {
      setWorking(false);
    }
  }

  async function remove(record: ManualRecordView) {
    setWorking(true);
    setMessage("");

    try {
      const response = await fetch(`${apiBasePath}/${section}`, {
        body: JSON.stringify({
          expectedVersion: record.version,
          id: record.id,
        }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(
          userFacingErrorMessage(payload, messages.errors.recordRemove),
        );
      }

      setRecords((current) => current.filter((item) => item.id !== record.id));
      setMessage(messages.onboarding.form.removed);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : messages.errors.recordRemove,
      );
    } finally {
      setWorking(false);
    }
  }

  async function completeSection() {
    if (
      nextPath === undefined ||
      profileVersion === undefined ||
      step === undefined
    ) {
      return;
    }

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
        throw new Error(
          userFacingErrorMessage(payload, messages.errors.stepCompletion),
        );
      }

      window.location.assign(nextPath);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : messages.errors.stepCompletion,
      );
      setWorking(false);
    }
  }

  async function loadMore() {
    if (nextCursor === null) {
      return;
    }

    setWorking(true);
    setMessage("");

    try {
      const response = await fetch(
        `${apiBasePath}/${section}?cursor=${encodeURIComponent(nextCursor)}&limit=20`,
      );
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(
          userFacingErrorMessage(payload, messages.errors.recordLoad),
        );
      }

      const page = payload as PageResponse;
      setRecords((current) => [...current, ...page.records]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : messages.errors.recordLoad,
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_0.8fr]">
      <form
        className="space-y-5 rounded-3xl border border-[var(--border)] bg-white p-6"
        onChange={() => {
          idempotencyKey.current = null;
        }}
        onSubmit={submit}
      >
        <h2 className="text-xl font-semibold">
          {messages.onboarding.form.common.addRecord}
        </h2>
        <FormFields
          accountOptions={accountOptions}
          currency={currency}
          section={section}
        />
        <button
          className="w-full rounded-2xl bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-60"
          disabled={working}
          type="submit"
        >
          {messages.onboarding.form.actions.saveRecord}
        </button>
      </form>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-xl font-semibold">
          {messages.onboarding.form.common.savedRecords}
        </h2>
        {records.length === 0 ? (
          <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
            {messages.onboarding.form.common.empty}
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
                    {firstMoneySummary(record.fields) === null ? (
                      messages.onboarding.form.common.manualConfiguration
                    ) : (
                      <bdi dir="ltr">{firstMoneySummary(record.fields)}</bdi>
                    )}
                  </p>
                </div>
                <button
                  className="text-sm font-semibold text-red-700"
                  disabled={working}
                  onClick={() => void remove(record)}
                  type="button"
                >
                  {messages.onboarding.form.actions.remove}
                </button>
              </li>
            ))}
          </ul>
        )}

        {nextCursor === null ? null : (
          <button
            className="mt-6 w-full rounded-2xl border border-[var(--border)] px-5 py-3 font-semibold disabled:opacity-50"
            disabled={working}
            onClick={() => void loadMore()}
            type="button"
          >
            {messages.financialData.actions.loadMore}
          </button>
        )}
        {nextPath === undefined || profileVersion === undefined || step === undefined ? null : (
          <>
            <button
              className="mt-6 w-full rounded-2xl border border-[var(--accent)] px-5 py-3 font-semibold text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canComplete || working}
              onClick={() => void completeSection()}
              type="button"
            >
              {messages.onboarding.form.actions.completeStep}
            </button>
            {!canComplete ? (
              <p className="mt-3 text-sm text-[var(--muted)]">
                {messages.onboarding.form.common.stepLocked}
              </p>
            ) : null}
          </>
        )}
        <p aria-live="polite" className="mt-3 text-sm text-[var(--muted)]">
          {message}
        </p>
      </section>
    </div>
  );
}

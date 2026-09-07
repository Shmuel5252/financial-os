import { appLocale, messages } from "@/lib/i18n";
import type { ManualRecordView, SerializedDomainValue } from "@/lib/onboarding/manual-record";

export function recordObject(value: SerializedDomainValue): Readonly<Record<string, SerializedDomainValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, SerializedDomainValue>> : {};
}

export function moneyFormValue(value: SerializedDomainValue): string | null {
  const object = recordObject(value);
  if (typeof object.amountMinor !== "string" || typeof object.currency !== "string") return null;
  const digits = new Intl.NumberFormat(appLocale.intlLocale, { currency: object.currency, style: "currency" }).resolvedOptions().maximumFractionDigits ?? 2;
  const negative = object.amountMinor.startsWith("-");
  const padded = (negative ? object.amountMinor.slice(1) : object.amountMinor).padStart(digits + 1, "0");
  return `${negative ? "-" : ""}${digits === 0 ? padded : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`}`;
}

const percentageFields: Readonly<Record<string, string>> = { certaintyBps: "certainty", annualInterestRateBps: "annualInterestRate", basisPoints: "percentage", confidenceBps: "confidence" };

export function recordFormValues(record: ManualRecordView): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(recordObject(record.fields)).map(([key, value]) => {
    if (percentageFields[key] && typeof value === "number") return [percentageFields[key], `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, "0")}`];
    return [key, value === null ? "" : typeof value === "boolean" ? value ? "yes" : "no" : moneyFormValue(value) ?? String(value)];
  }));
}

export function recordDetailRows(record: ManualRecordView, references: readonly Readonly<{ id: string; label: string }>[] = []) {
  const fields = messages.onboarding.form.fields;
  const financial = messages.financialData.form.fields;
  const labels: Readonly<Record<string, string>> = {
    name: record.section === "expenses" ? fields.expenseName : record.section === "income" ? fields.incomeName : record.section === "accounts" ? fields.accountName : record.section === "cards" ? fields.cardName : record.section === "loans" ? fields.loanName : record.section === "savings" ? financial.savingName : financial.definitionName,
    title: fields.goalTitle, amount: fields.amount, balance: fields.currentBalance,
    type: record.section === "goals" ? fields.goalType : record.section === "accounts" ? fields.accountType : financial.transactionType,
    issuer: fields.issuer, billingDay: fields.billingDay, limit: fields.limit, used: fields.currentlyUsed,
    category: fields.category, frequency: fields.frequency, nextDueDate: fields.nextDueDate,
    originalAmount: fields.originalAmount, remainingBalance: fields.remainingBalance, monthlyPayment: fields.monthlyPayment,
    annualInterestRateBps: fields.annualInterestRate, endDate: fields.endDateOptional, nextPaymentDate: fields.nextPaymentDate,
    expectedDate: fields.expectedDate, certaintyBps: fields.certainty, destination: fields.destination,
    kind: fields.safetyMarginType, basisPoints: fields.incomePercentage, targetAmount: fields.targetAmount,
    startingValue: fields.startingValue, currentValue: fields.currentValue, priority: fields.priority, targetDate: fields.targetDateOptional,
    accountId: financial.sourceAccount, destinationAccountId: financial.destinationAccount, date: financial.transactionDate,
    confidenceBps: fields.certainty, merchant: financial.merchantOptional, notes: financial.notesOptional,
    recurring: financial.recurring, refundOfTransactionId: financial.originalTransaction, active: financial.active,
    interval: financial.interval, startDate: financial.startDate, nextOccurrenceDate: financial.nextOccurrenceDate,
    accountIdentifierLast4: financial.lastFourOptional, availability: financial.availability, institution: financial.institutionOptional, maturityDate: financial.maturityDate,
  };
  const forms = messages.onboarding.form;
  const options = messages.financialData.form.options;
  const enums: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    category: forms.categories, frequency: forms.frequencies, destination: forms.destinations, kind: forms.safetyKinds,
    type: record.section === "goals" ? forms.goalTypes : record.section === "accounts" ? forms.accountTypes : options,
    availability: { liquid: options.liquid, fixed_term: options.fixedTerm, other: options.other },
  };
  const goalType = recordObject(record.fields).type;
  if (record.section === "goals" && typeof goalType === "string" && goalType in messages.management.goalFields) {
    const copy = messages.management.goalFields[goalType as keyof typeof messages.management.goalFields];
    Object.assign(labels, { targetAmount: copy.target, startingValue: copy.starting, currentValue: copy.current });
  }
  // Allowlist financial fields; never render source envelopes, audit internals or unknown provider payloads.
  return Object.entries(recordObject(record.fields)).filter(([key]) => key in labels).map(([key, value]) => {
    const money = moneyFormValue(value);
    const isReference = ["accountId", "destinationAccountId", "refundOfTransactionId"].includes(key);
    const text = value === null ? messages.management.notSpecified
      : money !== null ? `${money} ${recordObject(value).currency}`
      : typeof value === "boolean" ? value ? options.yes : options.no
      : isReference ? references.find((item) => item.id === value)?.label ?? messages.management.unavailableReference
      : key === "accountIdentifierLast4" ? `•••• ${String(value)}`
      : percentageFields[key] && typeof value === "number" ? `${value / 100}%`
      : enums[key]?.[String(value)] ?? String(value);
    return { key, label: labels[key]!, text, ltr: money !== null || key === "accountIdentifierLast4" || typeof value === "number" || /date/i.test(key) };
  });
}

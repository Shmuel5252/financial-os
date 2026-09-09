import { renderToStaticMarkup } from "react-dom/server";
import type { FocusEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
// Static UI rendering does not execute Next's server-action runtime.
vi.mock("@/lib/auth/actions", () => ({ signOutAction: vi.fn() }));
import { AppNavigation } from "@/components/navigation/app-navigation";
import { selectZeroOnFocus } from "@/components/forms/numeric-focus-boundary";
import { ManualSectionForm, RecordDetails, RecordEditorFields, buildFields, buildUpdateFields } from "@/components/onboarding/manual-section-form";
import { ProfileForm } from "@/components/onboarding/profile-form";
import { recordDetailRows, recordFormValues } from "@/lib/financial-data/record-presentation";
import { phaseTwoFinancialSections } from "@/lib/financial-data/sections";
import { messages } from "@/lib/i18n";
import { parseManualFields, toManualRecordView, type ManualRecord, type ManualRecordView, type ManualSection } from "@/lib/onboarding/manual-record";

function record(section: ManualSection, fields: unknown): ManualRecordView {
  return toManualRecordView({ id: "507f1f77bcf86cd799439011", section, fields: parseManualFields(section, fields), source: { kind: "manual" }, createdAt: new Date("2026-09-01T00:00:00Z"), updatedAt: new Date("2026-09-01T00:00:00Z"), version: 1 } as ManualRecord);
}
const money = (amount: string) => ({ amount, currency: "ILS" });
const savings = record("savings", { name: "ביטוח חיסכון", balance: money("90071992547409.93"), availability: "fixed_term", maturityDate: "2027-01-01", institution: "מוסד לבדיקה", accountIdentifierLast4: "1234" });
const goal = (type: string) => record("goals", { type, title: "יעד", targetAmount: money("9000"), startingValue: money("8000"), currentValue: money("7000"), priority: 3, targetDate: null });
const formData = (values: Readonly<Record<string, string>>) => { const form = new FormData(); for (const [key, value] of Object.entries(values)) form.set(key, value); return form; };

describe("financial management UX boundaries", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("provides consistent grouped navigation and distinct management back destinations", () => {
    for (const section of phaseTwoFinancialSections) {
      const html = renderToStaticMarkup(<AppNavigation currentPath={`/financial-data/${section}`} />);
      expect(html).toContain(`href="/financial-data"`);
      expect(html).toContain(messages.financialData.actions.back);
      expect(html).toContain(messages.management.backDashboard);
      expect(html).toContain("<details");
      expect(html).not.toContain('href="/"');
      expect(html).not.toContain("/onboarding");
    }
    expect(phaseTwoFinancialSections).toContain("safety_margin");
  });

  it("keeps management empty states and profile actions out of onboarding", () => {
    const html = renderToStaticMarkup(<ManualSectionForm apiBasePath="/api/financial-data" currency="ILS" initialRecords={[]} section="savings" />);
    expect(html).toContain(messages.management.empty);
    expect(html).not.toContain(messages.onboarding.form.actions.completeStep);
    expect(html).not.toContain(messages.onboarding.form.common.stepLocked);
    const profile = renderToStaticMarkup(<ProfileForm continuePath="/financial-data" initialProfile={null} management />);
    expect(profile).toContain(messages.management.save);
    expect(profile).not.toContain(messages.onboarding.profile.form.save);
  });

  it("opens full safe record details without financial precision loss or provider internals", () => {
    const html = renderToStaticMarkup(<RecordDetails apiBasePath="/api/financial-data" currency="ILS" record={savings} onUpdated={() => {}} />);
    for (const value of ["90071992547409.93 ILS", "מוסד לבדיקה", "2027-01-01", "•••• 1234", messages.management.edit]) expect(html).toContain(value);
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain(savings.id);
    const contaminated = { ...savings, fields: { ...(savings.fields as object), accessToken: "unit-test-forbidden-token", userId: "internal-owner" } };
    expect(JSON.stringify(recordDetailRows(contaminated))).not.toMatch(/unit-test-forbidden-token|internal-owner/);
    const provider = renderToStaticMarkup(<RecordDetails apiBasePath="/api/financial-data" currency="ILS" record={{ ...savings, source: { kind: "open_banking", provider: "financy" } }} onUpdated={() => {}} />);
    expect(provider).not.toContain(messages.management.edit);
    expect(provider).toContain(messages.onboarding.form.common.openBankingRecord);
  });

  it("round-trips saved money, percentage, dates and conditional fields through the existing validation", () => {
    const examples = [savings,
      record("accounts", { name: "בנק", type: "bank", balance: money("-9.93") }),
      record("income", { name: "הכנסה", amount: money("1.01"), certaintyBps: 8075, destination: "bank_account", expectedDate: "2026-09-10", frequency: "monthly" }),
      record("loans", { name: "הלוואה", originalAmount: money("10000"), remainingBalance: money("9000"), monthlyPayment: money("100"), annualInterestRateBps: 575, nextPaymentDate: "2026-10-01", endDate: null }),
      record("safety_margin", { kind: "income_percentage", basisPoints: 1250 }),
      record("expenses", { name: "ביטוח", category: "insurance", amount: money("5000"), frequency: "monthly", nextDueDate: "2026-10-01" }),
    ];
    for (const item of examples) {
      const fields = buildFields(item.section, formData(recordFormValues(item)), "ILS");
      expect(toManualRecordView({ ...item, fields: parseManualFields(item.section, fields), createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) } as ManualRecord).fields).toEqual(item.fields);
    }
    const editor = renderToStaticMarkup(<RecordEditorFields record={savings} currency="ILS" />);
    expect(editor).toContain('value="90071992547409.93"');
    expect(editor).toContain('name="maturityDate"');
    expect(editor).toContain('value="2027-01-01"');
  });

  it.each(Object.keys(messages.management.goalFields))("explains %s using its own metric and preserves signed-money conventions", (type) => {
    const item = goal(type);
    const copy = messages.management.goalFields[type as keyof typeof messages.management.goalFields];
    const rows = recordDetailRows(item);
    expect(rows.find((row) => row.key === "targetAmount")?.label).toBe(copy.target);
    expect(rows.find((row) => row.key === "startingValue")?.label).toBe(copy.starting);
    const values = recordFormValues(item);
    expect(() => parseManualFields("goals", buildFields("goals", formData({ ...values, currentValue: "-9000" }), "ILS"))).toThrow();
    expect(() => parseManualFields("goals", buildFields("goals", formData({ ...values, currentValue: "0", startingValue: "0" }), "ILS"))).not.toThrow();
    const update = buildUpdateFields(item, formData({ ...values, title: "שם חדש", currentValue: "0", targetAmount: "1" }), "ILS");
    expect(parseManualFields("goals", update)).toMatchObject({ title: "שם חדש", currentValue: { amountMinor: 700000n }, targetAmount: { amountMinor: 900000n } });
    const editor = renderToStaticMarkup(<RecordEditorFields record={item} currency="ILS" />);
    expect(editor).toContain('name="title"');
    expect(editor).not.toContain('name="targetAmount"');
  });

  it("selects zero for replacement without clearing zero, changing values, or selecting identifiers", () => {
    class Input { type = "text"; inputMode = "decimal"; value = "0"; select = vi.fn(); }
    vi.stubGlobal("HTMLInputElement", Input);
    const input = new Input();
    selectZeroOnFocus({ target: input } as unknown as FocusEvent<HTMLElement>);
    expect(input.select).toHaveBeenCalledOnce();
    expect(input.value).toBe("0");
    for (const value of ["123", "0000", "-9.5", ""]) {
      input.value = value; input.select.mockClear();
      selectZeroOnFocus({ target: input } as unknown as FocusEvent<HTMLElement>);
      expect(input.select).not.toHaveBeenCalled();
    }
  });

  it("keeps transaction category corrections out of direct editing while preserving exact update fields", () => {
    const item = record("transactions", { accountId: "507f1f77bcf86cd799439012", amount: money("12.34"), category: "food", confidenceBps: 10000, date: "2026-09-01", destinationAccountId: null, merchant: "בית עסק", notes: null, recurring: false, refundOfTransactionId: null, type: "expense" });
    const values = recordFormValues(item);
    const edited = buildUpdateFields(item, formData({ ...values, category: "other", amount: "13.34" }), "ILS");
    expect(parseManualFields("transactions", edited)).toMatchObject({ category: "food", amount: { amountMinor: 1334n } });
    const html = renderToStaticMarkup(<RecordEditorFields record={item} currency="ILS" accountOptions={[{ id: "507f1f77bcf86cd799439012", label: "בנק לבדיקה" }]} />);
    expect(html).toMatch(/<select[^>]*disabled=""[^>]*name="category"/);
    expect(html).toContain('type="hidden"');
    const details = renderToStaticMarkup(<RecordDetails apiBasePath="/api/financial-data" record={item} currency="ILS" onUpdated={() => {}} />);
    expect(details).toContain('href="/transaction-intelligence"');
  });
});

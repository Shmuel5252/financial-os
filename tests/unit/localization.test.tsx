import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import RootLayout from "@/app/layout";
import { ManualSectionForm } from "@/components/onboarding/manual-section-form";
import { ProfileForm } from "@/components/onboarding/profile-form";
import {
  appLocale,
  messages,
  userFacingErrorMessage,
} from "@/lib/i18n";
import type { ManualSection } from "@/lib/onboarding/manual-record";
import type { OnboardingStep } from "@/lib/profiles/profile";

const hebrewPattern = /[\u0590-\u05ff]/;

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectStrings);
  }

  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(collectStrings);
  }

  return [];
}

describe("Hebrew-first RTL localization", () => {
  it("defines Hebrew and RTL as the application defaults", () => {
    expect(appLocale).toEqual({
      direction: "rtl",
      htmlLanguage: "he",
      intlLocale: "he-IL",
    });

    const markup = renderToStaticMarkup(
      <RootLayout>
        <main>בדיקה</main>
      </RootLayout>,
    );

    expect(markup).toMatch(/<html[^>]+dir="rtl"[^>]+lang="he"/);
  });

  it("keeps product copy in a centralized Hebrew catalog", () => {
    const localizedCopy = collectStrings({
      ...messages,
      brand: undefined,
      signIn: {
        ...messages.signIn,
        providerName: undefined,
      },
    });

    expect(localizedCopy.length).toBeGreaterThan(80);
    expect(localizedCopy.every((text) => hebrewPattern.test(text))).toBe(true);
    expect(messages.onboarding.eyebrow("בדיקה")).toBe("קליטה ראשונית · בדיקה");
    expect(messages.onboarding.review.recordCount(2)).toBe("2 רשומות");
  });

  it("renders profile controls in Hebrew with isolated LTR technical values", () => {
    const markup = renderToStaticMarkup(
      <ProfileForm continuePath="/onboarding/income" initialProfile={null} />,
    );

    expect(markup).toContain(messages.onboarding.profile.form.name);
    expect(markup).toContain(messages.onboarding.profile.form.currency);
    expect(markup).toContain(messages.onboarding.profile.form.save);
    expect(markup).toMatch(/<input[^>]+id="countryCode"[^>]+dir="ltr"/);
    expect(markup).toMatch(/<input[^>]+id="primaryCurrency"[^>]+dir="ltr"/);
    expect(markup).toMatch(/<input[^>]+id="timeZone"[^>]+dir="ltr"/);
    expect(markup).not.toContain(">Save and continue<");
  });

  it("renders every Phase 1 manual section with Hebrew labels", () => {
    const cases: readonly Readonly<{
      expectedLabel: string;
      section: ManualSection;
      step: OnboardingStep;
    }>[] = [
      { expectedLabel: messages.onboarding.form.fields.incomeName, section: "income", step: "income" },
      { expectedLabel: messages.onboarding.form.fields.accountName, section: "accounts", step: "accounts" },
      { expectedLabel: messages.onboarding.form.fields.cardName, section: "cards", step: "cards" },
      { expectedLabel: messages.onboarding.form.fields.expenseName, section: "expenses", step: "expenses" },
      { expectedLabel: messages.onboarding.form.fields.loanName, section: "loans", step: "debts" },
      { expectedLabel: messages.onboarding.form.fields.safetyMarginType, section: "safety_margin", step: "safety_margin" },
      { expectedLabel: messages.onboarding.form.fields.goalTitle, section: "goals", step: "goals" },
    ];

    for (const testCase of cases) {
      const markup = renderToStaticMarkup(
        <ManualSectionForm
          canComplete
          currency="ILS"
          initialRecords={[]}
          nextPath="/onboarding/review"
          profileVersion={1}
          section={testCase.section}
          step={testCase.step}
        />,
      );

      expect(markup).toContain(messages.onboarding.form.common.addRecord);
      expect(markup).toContain(messages.onboarding.form.common.empty);
      expect(markup).toContain(testCase.expectedLabel);
      expect(markup).toContain("<bdi dir=\"ltr\">ILS</bdi>");
      expect(markup).not.toContain(">Save record<");
    }
  });

  it("maps internal API error codes to Hebrew without exposing server messages", () => {
    const result = userFacingErrorMessage(
      {
        error: {
          code: "CONFLICT",
          message: "The resource changed. Reload it and try again.",
        },
      },
      messages.errors.recordSave,
    );

    expect(result).toBe(messages.errors.public.CONFLICT);
    expect(result).not.toContain("resource changed");
  });

  it("renders the Phase 2 transaction, recurrence, and savings forms in Hebrew", () => {
    const sections = [
      {
        expected: messages.financialData.form.fields.transactionDate,
        section: "transactions",
      },
      {
        expected: messages.financialData.form.fields.nextOccurrenceDate,
        section: "recurring_transactions",
      },
      {
        expected: messages.financialData.form.fields.savingName,
        section: "savings",
      },
    ] as const;

    for (const item of sections) {
      const markup = renderToStaticMarkup(
        <ManualSectionForm
          accountOptions={[
            { id: "507f1f77bcf86cd799439011", label: "חשבון ראשי" },
          ]}
          apiBasePath="/api/financial-data"
          currency="ILS"
          initialRecords={[]}
          section={item.section}
        />,
      );

      expect(markup).toContain(item.expected);
      expect(markup).toContain(messages.onboarding.form.actions.saveRecord);
      expect(markup).toContain("dir=\"ltr\"");
    }
  });
});

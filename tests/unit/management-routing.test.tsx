import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ ready: true, signedIn: true, complete: true, list: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/lib/auth", () => ({ auth: async () => state.signedIn ? { user: { id: "507f1f77bcf86cd799439011" } } : null }));
vi.mock("@/lib/config/server-env", () => ({ getConfigurationStatus: () => ({ authentication: { ready: state.ready } }) }));
vi.mock("@/lib/profiles/profile-service", () => ({ loadProfile: async () => ({ fields: { primaryCurrency: "ILS" }, version: 9, onboarding: { status: state.complete ? "complete" : "in_progress", currentStep: "income" } }) }));
vi.mock("@/lib/onboarding/manual-record-service", () => ({ listManualRecords: async () => { state.list(); return []; }, listManualRecordPage: async () => ({ records: [], nextCursor: null }) }));

import FinancialDataSectionPage from "@/app/financial-data/[section]/page";
import OnboardingSectionPage from "@/app/onboarding/[section]/page";
import ReviewPage from "@/app/onboarding/review/page";
import { messages } from "@/lib/i18n";

describe("authenticated management routing (unit dependencies, not real OAuth acceptance)", () => {
  beforeEach(() => { state.complete = true; state.signedIn = true; state.ready = true; state.list.mockClear(); });
  it.each(["accounts", "cards", "expenses", "income", "loans", "goals", "safety_margin"])("redirects completed onboarding %s to the same management data", async (section) => {
    await expect(OnboardingSectionPage({ params: Promise.resolve({ section }) })).rejects.toThrow(`redirect:/financial-data/${section}`);
    expect(state.list).not.toHaveBeenCalled();
  });
  it("returns completed review to the hub without restarting onboarding", async () => {
    await expect(ReviewPage()).rejects.toThrow("redirect:/financial-data");
  });
  it("keeps first-time onboarding and its explicit completion action", async () => {
    state.complete = false;
    const html = renderToStaticMarkup(await OnboardingSectionPage({ params: Promise.resolve({ section: "income" }) }));
    expect(html).toContain(messages.onboarding.form.actions.completeStep);
    await expect(FinancialDataSectionPage({ params: Promise.resolve({ section: "income" }) })).rejects.toThrow("redirect:/onboarding/review");
  });
  it("renders a management return path without login/onboarding navigation for an authorized completed user", async () => {
    const html = renderToStaticMarkup(await FinancialDataSectionPage({ params: Promise.resolve({ section: "savings" }) }));
    expect(html).toContain(messages.financialData.actions.back);
    expect(html).not.toContain('href="/sign-in"');
    expect(html).not.toContain("קליטה ראשונית");
    expect(html).not.toContain(messages.onboarding.form.actions.completeStep);
  });
  it("retains authentication and invalid-section guards", async () => {
    state.signedIn = false;
    await expect(FinancialDataSectionPage({ params: Promise.resolve({ section: "savings" }) })).rejects.toThrow("redirect:/sign-in");
    state.signedIn = true;
    await expect(FinancialDataSectionPage({ params: Promise.resolve({ section: "secrets" }) })).rejects.toThrow("not-found");
  });
});

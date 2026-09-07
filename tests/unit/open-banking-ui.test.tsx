import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OpenBankingCenter } from "@/components/open-banking/open-banking-center";
import { ReconciliationRequiredError, toPublicError } from "@/lib/errors/application-error";
import { userFacingErrorMessage } from "@/lib/i18n";
import type { OpenBankingCenterView } from "@/lib/open-banking/open-banking";

describe("Open Banking Hebrew/RTL presentation", () => {
  it("explains the fail-closed reconnection gate in Hebrew without provider identifiers", () => {
    const error = new ReconciliationRequiredError();
    const publicError = toPublicError(error, "safe-correlation");
    expect(error.status).toBe(409);
    expect(publicError.error.code).toBe("RECONCILIATION_REQUIRED");
    expect(userFacingErrorMessage(publicError, "fallback")).toContain("נדרשת התאמה מתועדת להיסטוריה הקיימת");
    expect(userFacingErrorMessage(publicError, "fallback")).toContain("למנוע כפילות");
  });
  it("renders consent, freshness, exact LTR money, and explicit costly/destructive controls", () => {
    const center: OpenBankingCenterView = {
      accounts: [{
        balances: [{ amount: { amountMinor: "12345", currency: "ILS" }, referenceDate: "2026-09-03", type: "interimAvailable" }],
        currency: "ILS",
        displayName: "עו״ש משפחתי",
        type: "CHECKING",
      }],
      bindingClaimed: true,
      configured: true,
      connections: [{
        accountCount: 1,
        consentExpiresOn: "2026-12-01",
        freshness: "FRESH",
        id: "64f000000000000000000001",
        lastFetchedAt: "2026-09-03T08:00:00.000Z",
        lastFetchedDataDate: "2026-09-03",
        mode: "PSD2",
        status: "ACTIVE",
        transactionCount: 14,
        version: 1,
      }],
      latestRun: {
        accountObservationCount: 1,
        canonicalAccountCount: 1,
        canonicalTransactionCount: 10,
        completedAt: "2026-09-03T08:01:00.000Z",
        connectionObservationCount: 1,
        errorCategory: null,
        id: "64f000000000000000000002",
        startedAt: "2026-09-03T08:00:00.000Z",
        status: "completed",
        transactionObservationCount: 14,
      },
      policyVersion: "open-banking-policy-v1",
      provider: "financy",
    };
    const html = renderToStaticMarkup(<OpenBankingCenter initialCenter={center} />);
    expect(html).toContain("סנכרון אינו הסכמה לתשלום");
    expect(html).toContain("20 קרדיטים");
    expect(html).toContain("מוחקת את החיבור אצל Financy");
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("123.45 ILS");
    expect(html).not.toContain("64f000000000000000000001");
  });
});

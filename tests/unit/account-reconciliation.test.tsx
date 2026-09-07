import { randomUUID } from "node:crypto";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountReconciliationCenter } from "@/components/open-banking/account-reconciliation-center";
import { minimizeAccountIdentity, safeAccountLabel } from "@/lib/open-banking/account-identity";
import { accountReconciliationCommandSchema, ACCOUNT_RECONCILIATION_POLICY, type AccountReconciliationView } from "@/lib/open-banking/account-reconciliation";

afterEach(() => vi.unstubAllEnvs());

describe("Manual account reconciliation privacy, consent, and RTL", () => {
  it("does not claim synchronization is blocked when no legacy account requires reconciliation", () => {
    const html = renderToStaticMarkup(<AccountReconciliationCenter initialView={{ rows: [], transactionGate: "not_required", policyVersion: ACCOUNT_RECONCILIATION_POLICY }} />);
    expect(html).toContain("אין כרגע חשבונות היסטוריים");
    expect(html).not.toContain("הסנכרון נשאר חסום");
    expect(html).not.toContain('type="radio"');
  });
  it("requires an explicit candidate and attestation, rejects injected ownership, and allows uncertainty", () => {
    const base = { legacyKey: "a".repeat(64), candidateKey: "b".repeat(64), reviewToken: "c".repeat(64), idempotencyKey: randomUUID(), decision: "same_account", confirmation: true };
    expect(accountReconciliationCommandSchema.safeParse(base).success).toBe(true);
    expect(accountReconciliationCommandSchema.safeParse({ ...base, confirmation: false }).success).toBe(false);
    expect(accountReconciliationCommandSchema.safeParse({ ...base, candidateKey: null }).success).toBe(false);
    expect(accountReconciliationCommandSchema.safeParse({ ...base, userId: "injected" }).success).toBe(false);
    expect(accountReconciliationCommandSchema.safeParse({ ...base, decision: "cannot_determine", candidateKey: null, confirmation: false }).success).toBe(true);
    expect(accountReconciliationCommandSchema.safeParse({ ...base, decision: "not_same", candidateKey: null }).success).toBe(false);
  });

  it("minimizes documented identity, keeps leading zeros, separates hash domains, and never stores raw numbers", () => {
    vi.stubEnv("AUTH_SECRET", "test-only-account-identity-secret-of-sufficient-length");
    const input = { accountNumber: "0012-34567890", parsedAccount: { bank: "010", branch: "012", number: "001234567890" }, providerId: "fixture-bank", accountType: "CHECKING", currency: "ILS" };
    const result = minimizeAccountIdentity(input);
    expect(result.maskedNumber).toBe("•••• 7890");
    expect(result.bankCode).toBe("010");
    expect(result.branchCode).toBe("012");
    expect(result.referenceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result).toEqual(minimizeAccountIdentity({ ...input, accountNumber: "001234567890" }));
    expect(result.referenceDigest).not.toBe(minimizeAccountIdentity({ ...input, currency: "USD" }).referenceDigest);
    expect(result.referenceDigest).not.toBe(minimizeAccountIdentity({ ...input, accountNumber: "1234567890" }).referenceDigest);
    expect(JSON.stringify(result)).not.toContain(input.accountNumber);
    expect(JSON.stringify(result)).not.toContain(input.parsedAccount.number);
    expect(minimizeAccountIdentity({ ...input, accountNumber: null, parsedAccount: null }).referenceDigest).toBeNull();
    expect(safeAccountLabel("חשבון 1234 5678 9012\u202e")).toBe("חשבון ••••");
  });

  it("renders safe Hebrew comparisons without a preselected match and with every alternative", () => {
    const comparison = { institution: "מוסד לבדיקה", name: "החשבון שלי", type: "CHECKING" as const, currency: "ILS", maskedNumber: null, bankCode: null, branchCode: null };
    const view: AccountReconciliationView = { policyVersion: ACCOUNT_RECONCILIATION_POLICY, transactionGate: "pending", rows: [{
      key: "a".repeat(64), legacy: comparison, reviewToken: "b".repeat(64), status: "unresolved", confirmedAccount: null, lastDecisionAt: null,
      candidates: [{ key: "c".repeat(64), comparison: { ...comparison, maskedNumber: "•••• 6789", branchCode: "012" }, previouslyRejected: false }],
    }] };
    const html = renderToStaticMarkup(<AccountReconciliationCenter initialView={view} />);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("לא נשמר בזיהוי ההיסטורי");
    expect(html).toContain("לא ניתן לקבוע כרגע");
    expect(html).toContain("זה לא אותו חשבון");
    expect(html).toContain("אינו מייבא עסקאות ואינו משנה יתרות");
    expect(html).toContain("•••• 6789");
    expect(html).not.toContain("checked=");
    expect(html).toMatch(/disabled=""[^>]*>אישור: זה אותו חשבון/);
    expect(html).not.toContain("b".repeat(64));
  });
});

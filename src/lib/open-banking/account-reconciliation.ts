import { z } from "zod";

export const ACCOUNT_RECONCILIATION_POLICY = "financy-reconnection-v1";
export const ACCOUNT_RECONCILIATION_WORKFLOW = "manual-account-attestation-v1";
export const accountReconciliationCommandSchema = z.object({
  legacyKey: z.string().regex(/^[0-9a-f]{64}$/),
  candidateKey: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  reviewToken: z.string().regex(/^[0-9a-f]{64}$/),
  idempotencyKey: z.string().uuid(),
  decision: z.enum(["same_account", "not_same", "cannot_determine"]),
  confirmation: z.boolean(),
}).strict().superRefine((command, context) => {
  if (command.decision !== "cannot_determine" && command.candidateKey === null) {
    context.addIssue({ code: "custom", path: ["candidateKey"], message: "Select a candidate explicitly." });
  }
  if (command.decision === "same_account" && !command.confirmation) {
    context.addIssue({ code: "custom", path: ["confirmation"], message: "Explicit account identity attestation is required." });
  }
});
export type AccountReconciliationCommand = z.infer<typeof accountReconciliationCommandSchema>;
export type ReconciliationComparison = Readonly<{
  institution: string;
  name: string;
  type: "CARD" | "CHECKING" | "LOAN" | "SAVINGS" | "SECURITY";
  currency: string;
  maskedNumber: string | null;
  bankCode: string | null;
  branchCode: string | null;
}>;
export type ReconciliationCandidateView = Readonly<{
  key: string;
  comparison: ReconciliationComparison;
  previouslyRejected: boolean;
}>;
export type AccountReconciliationRow = Readonly<{
  key: string;
  legacy: ReconciliationComparison;
  reviewToken: string;
  candidates: readonly ReconciliationCandidateView[];
  status: "unresolved" | "confirmed" | "not_same" | "cannot_determine";
  confirmedAccount: ReconciliationComparison | null;
  lastDecisionAt: string | null;
}>;
export type AccountReconciliationView = Readonly<{
  rows: readonly AccountReconciliationRow[];
  policyVersion: typeof ACCOUNT_RECONCILIATION_POLICY;
  transactionGate: "pending" | "not_required";
}>;

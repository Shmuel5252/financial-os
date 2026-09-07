import { requireActor } from "@/lib/auth/actor";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { accountReconciliationCommandSchema } from "@/lib/open-banking/account-reconciliation";
import { decideAccountReconciliation, loadAccountReconciliation } from "@/lib/open-banking/account-reconciliation-service";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "bank-account-review-read");
    return noStoreJson({ review: await loadAccountReconciliation(actor) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const actor = await requireActor();
    await consumeMutationRateLimit(actor, "bank-account-review-decision");
    const command = parseUntrusted(accountReconciliationCommandSchema, await readJsonBody(request));
    await decideAccountReconciliation(actor, command);
    return noStoreJson({ recorded: true, financialImportPerformed: false });
  } catch (error) { return errorResponse(error); }
}

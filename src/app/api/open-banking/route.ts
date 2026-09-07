import { requireActor } from "@/lib/auth/actor";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { loadOpenBankingCenter } from "@/lib/open-banking/open-banking-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return noStoreJson({ center: await loadOpenBankingCenter(await requireActor()) });
  } catch (error) {
    return errorResponse(error);
  }
}

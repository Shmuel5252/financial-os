import { requireActor } from "@/lib/auth/actor";
import { assertTrustedMutationOrigin, readJsonBody } from "@/lib/http/request-guards";
import { errorResponse, noStoreJson } from "@/lib/http/route-response";
import { parseSearchQuery, rebuildSearchIndexCommandSchema } from "@/lib/search/search";
import { rebuildSearchIndex, searchAuthorized } from "@/lib/search/search-service";
import { consumeMutationRateLimit } from "@/lib/security/rate-limiter";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const actor = await requireActor(); const url = new URL(request.url); const query = parseSearchQuery(Object.fromEntries(url.searchParams.entries())); return noStoreJson({ page: await searchAuthorized(actor, query) }); } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try { assertTrustedMutationOrigin(request); const actor = await requireActor(); await consumeMutationRateLimit(actor, "search-index-rebuild"); parseUntrusted(rebuildSearchIndexCommandSchema, await readJsonBody(request)); return noStoreJson({ indexedCount: await rebuildSearchIndex(actor) }); } catch (error) { return errorResponse(error); }
}

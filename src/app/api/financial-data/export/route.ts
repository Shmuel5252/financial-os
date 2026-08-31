import { NextResponse } from "next/server";

import { requireActor } from "@/lib/auth/actor";
import { buildFinancialDataExport } from "@/lib/financial-data/financial-data-export-service";
import { errorResponse } from "@/lib/http/route-response";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireActor();
    const exported = await buildFinancialDataExport(actor);

    return NextResponse.json(exported, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition":
          'attachment; filename="financial-os-manual-data.json"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextResponse } from "next/server";

import { handlers } from "@/lib/auth";
import { getConfigurationStatus } from "@/lib/config/server-env";

const unavailableHandler = () =>
  NextResponse.json(
    {
      error: {
        code: "AUTH_NOT_CONFIGURED",
        message: "Authentication is not configured for this environment.",
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
      status: 503,
    },
  );

const handler = getConfigurationStatus().authentication.ready
  ? handlers
  : unavailableHandler;

export const GET = typeof handler === "function" ? handler : handler.GET;
export const POST = typeof handler === "function" ? handler : handler.POST;

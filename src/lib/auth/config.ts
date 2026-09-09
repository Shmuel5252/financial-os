import "server-only";

import { MongoDBAdapter } from "@auth/mongodb-adapter";
import type { NextAuthConfig } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import {
  getConfigurationStatus,
  getServerEnv,
} from "@/lib/config/server-env";
import { financialOsAuthCookies } from "@/lib/auth/cookies";
import { financialOsMongoAdapterOptions } from "@/lib/auth/persistence";
import { safeAuthLogger } from "@/lib/auth/safe-logger";
import { getMongoClientPromise } from "@/lib/db/mongodb";

function createAuthConfig(): NextAuthConfig {
  const env = getServerEnv();
  const status = getConfigurationStatus(env);
  const useSecureCookies =
    env.AUTH_URL?.startsWith("https://") ?? env.NODE_ENV === "production";
  const config: NextAuthConfig = {
    callbacks: {
      session({ session, token, user }) {
        const userId = user?.id ?? token?.sub;
        // Database sessions contain bearer tokens and adapter fields. Never
        // spread them (or the adapter user) into the public session response.
        return {
          expires: session.expires,
          user: {
            ...(userId === undefined ? {} : { id: userId }),
            name: session.user?.name ?? null,
            email: session.user?.email ?? null,
            image: session.user?.image ?? null,
          },
        };
      },
    },
    debug: false,
    logger: safeAuthLogger,
    cookies: financialOsAuthCookies(useSecureCookies),
    providers: [],
    session: {
      maxAge: 30 * 24 * 60 * 60,
      strategy: status.authentication.ready ? "database" : "jwt",
      updateAge: 24 * 60 * 60,
    },
    useSecureCookies,
  };

  if (env.AUTH_SECRET !== undefined) {
    config.secret = env.AUTH_SECRET;
  }

  if (
    status.authentication.ready &&
    env.GOOGLE_CLIENT_ID !== undefined &&
    env.GOOGLE_CLIENT_SECRET !== undefined &&
    env.MONGODB_DB_NAME !== undefined
  ) {
    config.adapter = MongoDBAdapter(
      // Connect only inside an awaited adapter operation; retry through the cache
      // after a failed attempt instead of retaining a rejected initialization promise.
      getMongoClientPromise,
      financialOsMongoAdapterOptions(env.MONGODB_DB_NAME),
    );
    config.providers = [
      GoogleProvider({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      }),
    ];
  }

  return config;
}

export const authConfig = createAuthConfig();

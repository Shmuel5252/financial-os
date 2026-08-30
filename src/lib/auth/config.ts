import "server-only";

import { MongoDBAdapter } from "@auth/mongodb-adapter";
import type { NextAuthConfig } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import {
  getConfigurationStatus,
  getServerEnv,
} from "@/lib/config/server-env";
import { getMongoClientPromise } from "@/lib/db/mongodb";

function createAuthConfig(): NextAuthConfig {
  const env = getServerEnv();
  const status = getConfigurationStatus(env);
  const config: NextAuthConfig = {
    callbacks: {
      session({ session, token, user }) {
        const userId = user?.id ?? token.sub;

        if (session.user !== undefined && userId !== undefined) {
          session.user.id = userId;
        }

        return session;
      },
    },
    debug: false,
    providers: [],
    session: {
      maxAge: 30 * 24 * 60 * 60,
      strategy: status.authentication.ready ? "database" : "jwt",
      updateAge: 24 * 60 * 60,
    },
    useSecureCookies:
      env.AUTH_URL?.startsWith("https://") ?? env.NODE_ENV === "production",
  };

  if (env.AUTH_SECRET !== undefined) {
    config.secret = env.AUTH_SECRET;
  }

  if (
    status.authentication.ready &&
    env.GOOGLE_CLIENT_ID !== undefined &&
    env.GOOGLE_CLIENT_SECRET !== undefined
  ) {
    config.adapter = MongoDBAdapter(getMongoClientPromise());
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

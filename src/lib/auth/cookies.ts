import type { CookiesOptions } from "@auth/core/types";

const COOKIE_NAMESPACE = "financial-os.authjs";

export function financialOsAuthCookies(
  useSecureCookies: boolean,
): Partial<CookiesOptions> {
  const securePrefix = useSecureCookies ? "__Secure-" : "";
  const hostPrefix = useSecureCookies ? "__Host-" : "";

  return {
    callbackUrl: {
      name: `${securePrefix}${COOKIE_NAMESPACE}.callback-url`,
    },
    csrfToken: {
      name: `${hostPrefix}${COOKIE_NAMESPACE}.csrf-token`,
    },
    nonce: {
      name: `${securePrefix}${COOKIE_NAMESPACE}.nonce`,
    },
    pkceCodeVerifier: {
      name: `${securePrefix}${COOKIE_NAMESPACE}.pkce.code-verifier`,
    },
    sessionToken: {
      name: `${securePrefix}${COOKIE_NAMESPACE}.session-token`,
    },
    state: {
      name: `${securePrefix}${COOKIE_NAMESPACE}.state`,
    },
    webauthnChallenge: {
      name: `${securePrefix}${COOKIE_NAMESPACE}.challenge`,
    },
  };
}

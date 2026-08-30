import { describe, expect, it } from "vitest";

import { financialOsAuthCookies } from "@/lib/auth/cookies";

describe("Auth.js cookie namespace", () => {
  it("uses a project-specific namespace for every local HTTP auth cookie", () => {
    const cookies = financialOsAuthCookies(false);
    const names = Object.values(cookies).map((cookie) => cookie.name);

    expect(new Set(names).size).toBe(7);
    expect(names).toHaveLength(7);
    expect(names.every((name) => name?.startsWith("financial-os.authjs."))).toBe(
      true,
    );
    expect(names).not.toContain("authjs.pkce.code_verifier");
    expect(names).not.toContain("authjs.session-token");
  });

  it("retains secure and host cookie prefixes for HTTPS deployments", () => {
    const cookies = financialOsAuthCookies(true);

    expect(cookies.sessionToken?.name).toBe(
      "__Secure-financial-os.authjs.session-token",
    );
    expect(cookies.csrfToken?.name).toBe(
      "__Host-financial-os.authjs.csrf-token",
    );
    expect(cookies.pkceCodeVerifier?.name).toBe(
      "__Secure-financial-os.authjs.pkce.code-verifier",
    );
  });
});

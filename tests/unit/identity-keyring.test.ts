import { afterEach, describe, expect, it, vi } from "vitest";
import { bankAlias } from "@/lib/open-banking/account-identity";
import { identityAlias, readableAliases, validateIdentityKeyring } from "@/lib/open-banking/identity-keyring";

// Synthetic values only; no real secret is read or produced.
const legacySecret = "synthetic-auth-secret-for-key-continuity-design-01";
const rotatedAuthSecret = "synthetic-rotated-auth-secret-after-decoupling-02";
const v1 = { version: 1, material: legacySecret }; const v2 = { version: 2, material: "synthetic-financy-identity-key-version-two-000003" };

describe("F design: Financy identity keyring (prototype, not wired)", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("step 1 decoupling is byte-identical: v1 = today's AUTH_SECRET bytes reproduces every stored alias kind", () => {
    vi.stubEnv("AUTH_SECRET", legacySecret);
    const keyring = { activeVersion: 1, keys: [v1] };
    for (const [kind, value] of [["subject", "provider-user"], ["connection", "c-1"], ["account", "a-1"], ["transaction", "t-1"], ["institution", "bank"],
      ["financy-account-identity-v1", "[\"p\",\"CHECKING\",\"ILS\",\"12345678\",\"12\",\"345\"]"], ["account-review-request", "uuid"]]) {
      expect(identityAlias(keyring, kind!, value!)).toBe(bankAlias(kind!, value!));
    }
  });

  it("after decoupling, rotating AUTH_SECRET no longer changes aliases (the coupling this design removes)", () => {
    const keyring = { activeVersion: 1, keys: [v1] }; const before = identityAlias(keyring, "subject", "provider-user");
    vi.stubEnv("AUTH_SECRET", rotatedAuthSecret);
    expect(bankAlias("subject", "provider-user")).not.toBe(before); // today's coupled derivation breaks
    expect(identityAlias(keyring, "subject", "provider-user")).toBe(before); // keyring derivation does not
  });

  it("step 2 identity-key rotation needs dual-read: new writes use v2, legacy v1 aliases stay resolvable", () => {
    const rotated = { activeVersion: 2, keys: [v1, v2] };
    const legacy = identityAlias({ activeVersion: 1, keys: [v1] }, "connection", "c-1");
    expect(identityAlias(rotated, "connection", "c-1")).not.toBe(legacy);
    expect(readableAliases(rotated, "connection", "c-1")).toEqual([{ version: 2, alias: identityAlias(rotated, "connection", "c-1") }, { version: 1, alias: legacy }]);
    // Dropping v1 too early makes every never-re-observed legacy record unresolvable: v1 must stay until continuity is proven.
    expect(readableAliases({ activeVersion: 2, keys: [v2] }, "connection", "c-1").map(item => item.alias)).not.toContain(legacy);
  });

  it("rollback: a keyring that still carries v1 as active reproduces pre-rotation aliases exactly", () => {
    const rolledBack = { activeVersion: 1, keys: [v1, v2] };
    expect(identityAlias(rolledBack, "account", "a-1")).toBe(identityAlias({ activeVersion: 1, keys: [v1] }, "account", "a-1"));
  });

  it("rejects malformed keyrings without reflecting key material", () => {
    for (const keyring of [{ activeVersion: 1, keys: [] }, { activeVersion: 3, keys: [v1, v2] }, { activeVersion: 1, keys: [v1, { ...v2, version: 1 }] },
      { activeVersion: 1, keys: [{ version: 1, material: "short" }] }, { activeVersion: 0, keys: [{ ...v1, version: 0 }] }]) {
      let message = ""; try { validateIdentityKeyring(keyring); } catch (error) { message = (error as Error).message; }
      expect(message).toBe("Identity keyring requires review");
    }
    expect(() => identityAlias({ activeVersion: 1, keys: [v1] }, "subject", "x", 2)).toThrow("Identity keyring requires review");
  });
});

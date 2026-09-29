import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { parseRecoveryKeyring } from "@/lib/operations/recovery-keys";

// Synthetic key material only; nothing is read from the process environment.
const k1 = randomBytes(32).toString("base64"); const k2 = randomBytes(32).toString("base64");

it("parses versioned keys, keeps older versions readable and selects the active one", () => {
  const keyring = parseRecoveryKeyring({ RECOVERY_PACKAGE_KEY_V1: k1, RECOVERY_PACKAGE_KEY_V2: k2, RECOVERY_PACKAGE_KEY_ACTIVE_VERSION: "2",
    UNRELATED_V1: "ignored", RECOVERY_LEDGER_KEY_V1: k1 }, "RECOVERY_PACKAGE_KEY");
  expect(keyring.keys.map(key => key.version)).toEqual([1, 2]);
  expect(keyring.active.version).toBe(2);
  expect(Buffer.from(keyring.active.material).toString("base64")).toBe(k2);
});

it("fails closed without echoing values on missing, malformed or short keys", () => {
  for (const source of [{}, { RECOVERY_PACKAGE_KEY_V1: k1 }, { RECOVERY_PACKAGE_KEY_V1: k1, RECOVERY_PACKAGE_KEY_ACTIVE_VERSION: "2" },
    { RECOVERY_PACKAGE_KEY_V1: "not-base64!", RECOVERY_PACKAGE_KEY_ACTIVE_VERSION: "1" },
    { RECOVERY_PACKAGE_KEY_V1: randomBytes(16).toString("base64"), RECOVERY_PACKAGE_KEY_ACTIVE_VERSION: "1" }]) {
    let message = ""; try { parseRecoveryKeyring(source, "RECOVERY_PACKAGE_KEY"); } catch (error) { message = (error as Error).message; }
    expect(message).toBe("Recovery keys require review");
    for (const value of Object.values(source)) expect(message).not.toContain(value);
  }
  expect(() => parseRecoveryKeyring({ X_V1: k1, X_ACTIVE_VERSION: "1" }, "x")).toThrow("Recovery keys require review");
});

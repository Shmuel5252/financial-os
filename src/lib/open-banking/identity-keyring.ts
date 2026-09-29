/** DESIGN PROTOTYPE (F, PHASE_18_KEY_CONTINUITY_DESIGN.md): versioned Financy identity keyring.
 * Intentionally not referenced by runtime code; wiring it in, provisioning keys or rotating anything needs separate approval.
 */
import "server-only";
import { createHmac } from "node:crypto";

export type IdentityKey = Readonly<{ version: number; material: string }>;
export type IdentityKeyring = Readonly<{ activeVersion: number; keys: readonly IdentityKey[] }>;

const fail = (): never => { throw new Error("Identity keyring requires review"); };

/** Fixed-format validation; errors never include key material. */
export function validateIdentityKeyring(keyring: IdentityKeyring): IdentityKeyring {
  const versions = keyring.keys.map(key => key.version);
  if (keyring.keys.length === 0 || new Set(versions).size !== versions.length || !versions.includes(keyring.activeVersion)
    || keyring.keys.some(key => !Number.isSafeInteger(key.version) || key.version < 1 || typeof key.material !== "string" || key.material.length < 32)) return fail();
  return keyring;
}

/** Same derivation as today's bankAlias/alias: HMAC-SHA256(material, "financy:<kind>:<value>"). v1 material = current AUTH_SECRET bytes. */
export function identityAlias(keyring: IdentityKeyring, kind: string, value: string, version = keyring.activeVersion): string {
  const key = validateIdentityKeyring(keyring).keys.find(item => item.version === version) ?? fail();
  return createHmac("sha256", key.material).update(`financy:${kind}:${value}`, "utf8").digest("hex");
}

/** Dual-read during a rotation: every readable version's alias, newest first, for lookup; writes use the active version only. */
export function readableAliases(keyring: IdentityKeyring, kind: string, value: string): readonly Readonly<{ version: number; alias: string }>[] {
  return [...validateIdentityKeyring(keyring).keys].sort((left, right) => right.version - left.version)
    .map(key => ({ version: key.version, alias: identityAlias(keyring, kind, value, key.version) }));
}

/** Versioned recovery key interface (package and ledger keys). Pure: callers pass the secret source; nothing reads
 * process.env here, and no value is ever echoed. Real key material comes from the platform/runner secret store (A/B).
 */
import "server-only";

export type VersionedKey = Readonly<{ version: number; material: Uint8Array }>;
export type RecoveryKeyring = Readonly<{ active: VersionedKey; keys: readonly VersionedKey[] }>;

const fail = (): never => { throw new Error("Recovery keys require review"); };

/** Reads `${prefix}_V<n>` (base64, exactly 32 bytes) and `${prefix}_ACTIVE_VERSION`; older versions stay readable for restore. */
export function parseRecoveryKeyring(source: Readonly<Record<string, string | undefined>>, prefix: string): RecoveryKeyring {
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(prefix)) return fail();
  const keys: VersionedKey[] = [];
  for (const [name, value] of Object.entries(source)) {
    const match = new RegExp(`^${prefix}_V([1-9][0-9]{0,5})$`).exec(name);
    if (!match || value === undefined || value === "") continue;
    if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return fail();
    const material = Uint8Array.from(Buffer.from(value, "base64"));
    if (material.length !== 32) return fail();
    keys.push({ version: Number(match[1]), material });
  }
  const activeVersion = Number(source[`${prefix}_ACTIVE_VERSION`]);
  const active = keys.find(key => key.version === activeVersion) ?? fail();
  return { active, keys: keys.sort((left, right) => left.version - right.version) };
}

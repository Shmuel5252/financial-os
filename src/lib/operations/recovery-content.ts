import "server-only";
import { Long, ObjectId } from "mongodb";

const forbiddenField = /^(?:access_?token|refresh_?token|id_?token|session_?token|session_?state|token|tokenHash|verificationToken|authorization|cookie|set-cookie|password|passwd|client_?secret|api_?key|auth_?secret|private_?key|signing_?key|encryption_?key|credentials|rawProviderPayload|mongodb_?uri|cvv|cvc|cardNumber)$/i;
const forbiddenText = /(?:mongodb(?:\+srv)?:\/\/|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]+|\bsk-ant-[A-Za-z0-9_-]+|\bAIza[A-Za-z0-9_-]{20,})/;

/** Defense in depth, not a field-level exporter or proof arbitrary free text contains no secret.
 * Opaque BSON/code/binary cannot bypass recursive inspection. No values are reflected in errors.
 */
export function assertRecoveryContent(value: unknown, depth = 0): void {
  const fail = () => { throw new Error("Recovery content requires review"); };
  if (depth > 64) return fail();
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") { if (forbiddenText.test(value)) return fail(); return; }
  if (typeof value === "number") { if (!Number.isFinite(value)) return fail(); return; }
  if (value instanceof ObjectId || Long.isLong(value)) return;
  if (value instanceof Date) { if (!Number.isFinite(value.getTime())) return fail(); return; }
  if (Array.isArray(value)) { for (const item of value) assertRecoveryContent(item, depth + 1); return; }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return fail();
  for (const [name, item] of Object.entries(value)) {
    if (forbiddenField.test(name) || ["__proto__", "prototype", "constructor"].includes(name)) return fail();
    assertRecoveryContent(item, depth + 1);
  }
}

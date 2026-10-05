import { describe, expect, it } from "vitest";
import { dataClassification } from "../security/data-classification";
import { derivationCalls, derivers, hmacKeySources, keyContinuityFindings, keyedFields, secretMentions, secretScripts } from "../security/secret-derivation-inventory";
import { secretDerivationSites } from "../security/secret-derivation-sites";

// Phase 18 row 18-13 (repository portion): every use of AUTH_SECRET and every value derived from it - transitively - is classified,
// and every stored keyed digest has a declared key source. A new read, wrapper, call site, keyed HMAC or derived stored field fails here
// until it is classified in tests/security/secret-derivation-inventory.ts.
describe("AUTH_SECRET derivation inventory (18-13)", () => {
  const scan = secretDerivationSites();

  it("pins every mention of the secret names in src/, workers/ and scripts/", () => {
    expect(Object.fromEntries(scan.mentions)).toEqual(Object.fromEntries(Object.entries(secretMentions).map(([key, entry]) => [key, entry.count])));
    expect(Object.fromEntries(scan.scripts)).toEqual(secretScripts);
  }, 120_000);

  it("pins the transitive set of derivers (functions whose result is derived from the secret)", () => {
    expect([...scan.derivers].sort()).toEqual(Object.keys(derivers).sort());
  }, 120_000);

  it("pins every call of a deriver with its classified use, and stored uses name their fields", () => {
    expect(Object.fromEntries(scan.calls)).toEqual(Object.fromEntries(Object.entries(derivationCalls).map(([key, entry]) => [key, entry.count])));
    for (const [key, entry] of Object.entries(derivationCalls)) {
      expect(entry.uses.length, key).toBeGreaterThan(0);
      if (entry.persisted.length > 0) expect(entry.uses, `${key}: stored values are a persist use`).toContain("persist");
      if (entry.uses.includes("persist") && entry.persisted.length === 0) expect(entry.note, `${key}: persist without fields must explain where`).toMatch(/stored|listed/);
      for (const field of entry.persisted) {
        const [collection, path] = field.split(" ") as [string, string];
        expect(keyedFields[collection]?.[path]?.source, `${key}: ${field} must be a keyed field derived from AUTH_SECRET`).toMatch(/^AUTH_SECRET:/);
      }
    }
  }, 120_000);

  it("classifies the key of every keyed HMAC; only the two Financy alias roots use AUTH_SECRET", () => {
    expect(Object.fromEntries(scan.hmacKeys)).toEqual(Object.fromEntries(Object.keys(hmacKeySources).map((key) => [key, 1])));
    expect(Object.entries(hmacKeySources).filter(([, source]) => source === "AUTH_SECRET").map(([site]) => site).sort())
      .toEqual(["src/lib/open-banking/account-identity.ts#bankAlias createHmac(secret)", "src/lib/open-banking/open-banking-service.ts#alias createHmac(key)"]);
  }, 120_000);

  it("gives every 18-07 hmac field a key source, and records where 18-07 classifies an AUTH_SECRET-derived field otherwise", () => {
    const hmac = Object.entries(dataClassification).flatMap(([name, entry]) =>
      Object.entries(entry.fields).filter(([, [, , transform]]) => transform === "hmac").map(([path]) => `${name} ${path}`));
    const declared = Object.entries(keyedFields).flatMap(([name, fields]) => Object.entries(fields).map(([path, key]) => ({ field: `${name} ${path}`, key })));
    expect(declared.filter(({ key }) => key.classified18_07 === undefined).map(({ field }) => field).sort()).toEqual(hmac.sort());
    for (const { field, key } of declared.filter(({ key }) => key.classified18_07 !== undefined)) {
      const [name, path] = field.split(" ") as [string, string];
      // The discrepancy is pinned: a corrected 18-07 entry (transform hmac) fails here until this record is updated.
      expect(dataClassification[name]?.fields[path]?.[2], `${field}: 18-07 transform`).toBe(key.classified18_07);
      expect(Object.values(keyContinuityFindings).some((text) => text.includes(path)), `${field}: discrepancy recorded as a finding`).toBe(true);
    }
  });

  it("every AUTH_SECRET-derived stored field is produced by at least one classified call (or is a documented copy)", () => {
    const produced = new Set(Object.values(derivationCalls).flatMap((entry) => entry.persisted));
    for (const [name, fields] of Object.entries(keyedFields)) {
      for (const [path, key] of Object.entries(fields)) {
        if (!key.source.startsWith("AUTH_SECRET:")) continue;
        const copied = /\(copied|permitted by the type/.test(key.source);
        expect(produced.has(`${name} ${path}`) || copied, `${name} ${path}: no classified call stores it`).toBe(true);
      }
    }
  });
});

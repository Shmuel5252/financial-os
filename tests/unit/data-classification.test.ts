import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { sectionCollections } from "@/lib/onboarding/manual-record-repository";
import { manualSectionDomainSchemas } from "@/lib/onboarding/manual-record";
import { uncoveredPaths } from "../security/classification-coverage";
import { discoverCollections, retentionSites, typedCollectionFields, undeclaredWrites } from "../security/collection-discovery";
import { authAdapterVersions, dataClassification, rawSecretsAtRest, retentionMechanisms, subtreeShapes, templateRetention, unresolvedCollectionSites } from "../security/data-classification";
import { subtreeShapeDigests } from "../security/subtree-shapes";

// Phase 18 rows 18-07/18-20 (repository portion): the classification in tests/security/data-classification.ts must describe exactly
// what the code stores today. New collections, fields, raw secrets, TTL indexes or hard-delete paths fail here until classified.
const top = (path: string) => path.split(/[.[{]/)[0]!;
const classified = (name: string) => new Set(Object.keys(dataClassification[name]!.fields).map(top));

/** Object keys a zod schema accepts (through unions, pipes, optional/nullable wrappers). */
function zodKeys(schema: ZodType): Set<string> {
  const def = (schema as unknown as { _zod: { def: Record<string, unknown> } })._zod.def;
  switch (def.type) {
    case "object": return new Set(Object.keys(def.shape as object));
    case "union": return new Set((def.options as ZodType[]).flatMap((option) => [...zodKeys(option)]));
    case "pipe": return zodKeys(def.in as ZodType);
    case "optional": case "nullable": case "default": case "readonly": return zodKeys(def.innerType as ZodType);
    default: throw new Error(`zod ${String(def.type)} is not handled; extend zodKeys`);
  }
}

describe("data classification inventory (18-07/18-20)", () => {
  const typed = typedCollectionFields();

  it("classifies exactly every governed collection, and every collection name the type checker can resolve (typed or not)", () => {
    expect(Object.keys(dataClassification).sort()).toEqual([...discoverCollections()].sort());
    for (const name of typed.names) expect(name in dataClassification, `${name}: collection opened in code is not classified`).toBe(true);
  }, 120_000);

  it("explains every .collection(name) call whose name is not a single string literal", () => {
    const actual: Record<string, number> = {};
    for (const site of typed.unresolved) { const file = site.split(":")[0]!; actual[file] = (actual[file] ?? 0) + 1; }
    expect(actual).toEqual(Object.fromEntries(Object.entries(unresolvedCollectionSites).map(([file, entry]) => [file, entry.count])));
  });

  it("classifies exactly the top-level fields of every typed collection (type checker) and of every manual section", () => {
    for (const [name, entry] of Object.entries(dataClassification)) {
      const declared = typed.fields.get(name) ?? new Set<string>();
      if (entry.fieldSource === "auth-adapter") {
        // Written by @auth/mongodb-adapter: app-side typed views (e.g. household identity reads) must be a subset.
        for (const field of declared) expect(classified(name).has(field), `${name}.${field}: classify the adapter field`).toBe(true);
        continue;
      }
      const expected = entry.fieldSource === "manual-section" ? new Set([...declared, ...(typed.manualTree.get("") ?? [])]) : declared;
      expect(expected.size, `${name}: no typed document found - type the collection or change fieldSource`).toBeGreaterThan(0);
      expect([...classified(name)].sort(), `${name}: classified top-level fields vs document type`).toEqual([...expected].sort());
    }
  });

  it("classifies nested fields wherever the classification goes below a field (a new nested field fails until classified)", () => {
    for (const [name, entry] of Object.entries(dataClassification)) {
      if (entry.fieldSource === "auth-adapter") continue;
      const tree = entry.fieldSource === "manual-section" ? new Map([...typed.manualTree, ...(typed.trees.get(name) ?? [])]) : typed.trees.get(name)!;
      expect(uncoveredPaths(tree, Object.keys(entry.fields)), `${name}: unclassified nested fields`).toEqual([]);
    }
  });

  it("writes no literal field that the collection's document type does not declare (insert/update/replace on Collection<T>)", () => {
    expect(undeclaredWrites()).toEqual([]);
  }, 120_000);

  it("pins the shape of every subtree that one row classifies as a whole (a new nested field below it fails until re-reviewed)", () => {
    expect(subtreeShapeDigests(typed.trees, typed.manualTree)).toEqual(subtreeShapes);
  });

  it("pins the Auth.js versions whose adapter writes the auth collections (an upgrade needs a field re-review)", () => {
    const installed = (name: string) => (JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")) as { version: string }).version;
    expect(Object.fromEntries(Object.keys(authAdapterVersions).map((name) => [name, installed(name)]))).toEqual(authAdapterVersions);
  });

  it("classifies exactly the fields.* keys of every manual-section domain schema", () => {
    for (const [section, collection] of Object.entries(sectionCollections)) {
      const schema = manualSectionDomainSchemas[section as keyof typeof manualSectionDomainSchemas] as unknown as ZodType;
      const keys = Object.keys(dataClassification[collection]!.fields).filter((path) => path.startsWith("fields.")).map((path) => path.slice(7).split(/[.[]/)[0]!);
      expect([...new Set(keys)].sort(), `${collection}: fields.* vs ${section} domain schema`).toEqual([...zodKeys(schema)].sort());
      expect(dataClassification[collection]!.fieldSource).toBe("manual-section");
    }
  });

  it("never calls a transformed identifier anonymous, and keeps pseudonymization consistent", () => {
    for (const [name, entry] of Object.entries(dataClassification)) {
      expect(entry.retention.length, `${name}: retention evidence`).toBeGreaterThan(10);
      for (const [path, [kind, personal, transform, note]] of Object.entries(entry.fields)) {
        const where = `${name}.${path}`;
        if (kind === "pseudonymous-identifier") expect(personal, `${where}: a hashed/HMAC identifier is pseudonymous personal data`).toBe("pseudonymous");
        if (personal === "pseudonymous") expect(["sha256", "hmac"], `${where}: pseudonymous needs a hash/HMAC transform`).toContain(transform);
        if (["record-id", "owner-id", "reference-id", "direct-identifier"].includes(kind)) {
          expect(["sha256", "hmac"].includes(transform), `${where}: a hashed identifier is a pseudonymous-identifier`).toBe(false);
        }
        if (["sha256", "hmac"].includes(transform) && /\b(e-?mail|user ?id|owner|name)\b/i.test(note) && kind !== "pseudonymous-identifier") {
          expect(personal, `${where}: a hash over personal input is personal data`).not.toBe("none");
        }
        if (kind === "direct-identifier") expect(personal, `${where}: a direct identifier is personal`).not.toBe("none");
        if (kind === "owner-id") expect(personal, `${where}: a user id is personal`).not.toBe("none");
        expect(/anonym/i.test(note.replace(/not anonymous/gi, "")), `${where}: never describe a value as anonymous`).toBe(false);
      }
    }
  });

  it("lists every raw secret stored at rest; a new one fails until it is reviewed", () => {
    const secrets = Object.entries(dataClassification).flatMap(([name, entry]) =>
      Object.entries(entry.fields).filter(([, [kind]]) => kind === "secret").map(([path]) => `${name}.${path}`));
    expect(secrets.sort()).toEqual([...rawSecretsAtRest].sort());
  });

  it("classifies exactly every TTL index option and hard-delete call in src/, workers/ and scripts/", () => {
    const actual = Object.fromEntries(retentionSites());
    expect(actual).toEqual(Object.fromEntries(Object.entries(retentionMechanisms).map(([site, entry]) => [site, entry.count])));
    const ttl = Object.keys(actual).filter((site) => site.endsWith(" expireAfterSeconds"));
    for (const site of ttl) expect(dataClassification[retentionMechanisms[site]!.collections]?.retention, `${site}: TTL collection retention`).toMatch(/TTL/);
    for (const [name, entry] of Object.entries(dataClassification)) {
      if (/TTL index on/i.test(entry.retention)) expect(ttl.some((site) => retentionMechanisms[site]!.collections === name), `${name}: claims a TTL index`).toBe(true);
    }
  });

  it("matches the retention the backup template defines (lifecycle, Object Lock, worker log group)", () => {
    const template = JSON.parse(readFileSync("infra/aws/financial-os-backup.template.json", "utf8")) as { Resources: Record<string, { Type: string; Properties: Record<string, unknown> }> };
    const resources = Object.values(template.Resources);
    const bucket = resources.find((resource) => resource.Type === "AWS::S3::Bucket")!.Properties as {
      ObjectLockConfiguration: { Rule: { DefaultRetention: unknown } }; LifecycleConfiguration: { Rules: unknown[] } };
    expect(bucket.ObjectLockConfiguration.Rule.DefaultRetention).toEqual(templateRetention.objectLockDefault);
    expect(bucket.LifecycleConfiguration.Rules).toEqual(templateRetention.lifecycleRules);
    const logGroups = resources.filter((resource) => resource.Type === "AWS::Logs::LogGroup").map((resource) => resource.Properties.RetentionInDays);
    expect(logGroups).toEqual([templateRetention.workerLogRetentionInDays]);
    expect(resources.filter((resource) => resource.Type === "AWS::S3::Bucket")).toHaveLength(1);
  });
});

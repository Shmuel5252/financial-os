import { randomBytes, randomUUID } from "node:crypto";
import { BSON, ObjectId, type Document } from "mongodb";
import { describe, expect, it } from "vitest";
import { createIsolatedRecoveryTarget } from "@/lib/operations/isolated-recovery-target";
import { createBackupPackage, openBackupPackage } from "@/lib/operations/backup-package";
import { initialRecoverySchemas } from "@/lib/operations/recovery-schemas";
import { recoveryCollections } from "@/lib/operations/recovery-plan";
import { profileRepositoryForDatabase } from "@/lib/profiles/profile-repository";
import { saveProfile } from "@/lib/profiles/profile-service";
import { manualRecordRepositoryForDatabase } from "@/lib/onboarding/manual-record-repository";
import { createManualRecord } from "@/lib/onboarding/manual-record-service";
import { beginDeletion, restorationDisposition } from "@/lib/operations/deletion-ledger";

const uri = process.env.MONGODB_TEST_URI;
const realMongo = uri ? describe : describe.skip;
realMongo("reviewed application profile/manual schemas in isolated recovery package", () => {
  it("roundtrips real repository BSON through signed manifest, suppresses erased owner and recreates actual indexes", async () => {
    const source = await createIsolatedRecoveryTarget(uri!); const target = await createIsolatedRecoveryTarget(uri!);
    try {
      const profiles = profileRepositoryForDatabase(source.database); await profiles.ensureIndexes();
      const accounts = manualRecordRepositoryForDatabase(source.database, "accounts"); await accounts.ensureIndexes();
      const actors = [new ObjectId(), new ObjectId()].map(id => ({ kind: "user" as const, userId: id.toHexString() }));
      for (const actor of actors) {
        await source.database.collection("authUsers").insertOne({ _id: new ObjectId(actor.userId), name: "Synthetic" });
        await saveProfile(actor, { countryCode: "IL", displayName: "בדיקה", expectedVersion: null, householdType: "single", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" }, { repository: profiles });
        await createManualRecord(actor, "accounts", { name: "בדיקה", type: "bank", balance: { amount: "90071992547409.93", currency: "ILS" } }, randomUUID(), { profileRepository: profiles, repository: accounts });
      }
      const input: Record<string, Document[]> = {};
      for (const name of recoveryCollections) input[name] = await source.database.collection(name).find().sort({ _id: 1 }).toArray();
      const key = { version: 1, material: randomBytes(32) }; const indexDigest = "a".repeat(64);
      const pack = createBackupPackage(input, initialRecoverySchemas, indexDigest, key);
      const opened = openBackupPackage(pack, initialRecoverySchemas, indexDigest, key);
      const ledgerKey = { version: 1, material: randomBytes(32) };
      const receipt = beginDeletion(actors[0]!, "isolated-test", randomUUID(), 1000, ledgerKey);
      const restoredProfiles = profileRepositoryForDatabase(target.database); await restoredProfiles.ensureIndexes();
      const restoredAccounts = manualRecordRepositoryForDatabase(target.database, "accounts"); await restoredAccounts.ensureIndexes();
      for (const name of ["authUsers", "profiles", "accounts"]) {
        for (const row of opened[name]!) {
          const ownerId = (name === "authUsers" ? row._id : row.userId).toHexString();
          const disposition = restorationDisposition({ ownerId, contributingSubjectIds: [], receipts: [receipt], environment: "isolated-test", keys: [ledgerKey], now: 1100, ledgerReadAt: 1100, maxLedgerAgeMs: 0, authoritativeRevision: 1, suppliedRevision: 1 });
          if (disposition === "preserve") await target.database.collection(name).insertOne(row);
        }
      }
      expect(await restoredAccounts.listForActor(actors[0]!)).toHaveLength(0);
      const surviving = await restoredAccounts.listForActor(actors[1]!);
      expect(surviving).toHaveLength(1);
      const raw = (await target.database.collection("accounts").findOne())!;
      expect(raw.fields.balance.amountMinor.toString()).toBe("9007199254740993");
      expect(BSON.serialize(raw)).toEqual(BSON.serialize(input.accounts!.find(r => r.userId.toHexString() === actors[1]!.userId)!));
      expect(await source.database.collection("accounts").countDocuments()).toBe(2);
      expect(await target.database.collection("authSessions").countDocuments()).toBe(0);
      const expectedIndexes = await source.database.collection("accounts").listIndexes().toArray();
      expect(await target.database.collection("accounts").listIndexes().toArray()).toEqual(expectedIndexes);
      await expect(target.database.collection("accounts").insertOne(raw)).rejects.toMatchObject({ code: 11000 });
      const bad = { ...raw, fields: { ...raw.fields, unknownSensitiveField: "synthetic" } };
      expect(() => initialRecoverySchemas.accounts!.project(bad)).toThrow("Recovery schema requires review");
      expect(() => initialRecoverySchemas.accounts!.project({ ...raw, schemaVersion: 999 })).toThrow();
      expect(() => createBackupPackage({ ...input, bankDevelopmentArchive: [{ opaque: "unreviewed" }] }, initialRecoverySchemas, indexDigest, key)).toThrow();
    } finally { await target.dispose(); await source.dispose(); }
  }, 30000);
});

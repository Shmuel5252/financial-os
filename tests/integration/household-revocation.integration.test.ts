// W1 regression (Phase 18 row 18-14): an accepted invitation token is spent. A member who was removed or who left can never use
// it - expired or not, current or from an earlier membership cycle - to restore access; rejoining needs a NEW owner invitation.
// Real route handlers, services and repositories on an isolated loopback MongoDB database (synthetic data only). Each refused
// attempt must disclose nothing (the owner's shared account name) and change no state (database fingerprint unchanged).
import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, call, expectRefused, marker, newActor, openHarness, type Harness } from "../security/route-harness";

vi.mock("@/lib/auth/actor", async () => (await import("../security/route-harness")).mockedActorModule());

const uri = process.env.MONGODB_TEST_URI;
const profile = { countryCode: "IL", displayName: "Synthetic", expectedVersion: null, householdType: "single", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" };
const MEMBER_EMAIL = "member@example.invalid";

(uri ? describe : describe.skip)("household invitation tokens cannot undo revocation (W1)", () => {
  let h: Harness;
  const owner = newActor(); const member = newActor();
  const sharedName = marker("owner-shared-account");

  beforeAll(async () => {
    h = await openHarness(uri!);
    for (const [actor, email] of [[owner, "owner@example.invalid"], [member, MEMBER_EMAIL]] as const) {
      await h.db.collection("authUsers").insertOne({ _id: new ObjectId(actor.userId), email, name: email.split("@")[0] });
      actAs(actor); expect((await call("profile", "PUT", { body: profile })).status).toBe(200);
    }
  }, 60_000);
  afterAll(async () => { actAs(null); await h?.dispose(); });

  /** Owner creates a household that shares an account named `sharedName`; returns its id. */
  async function household(): Promise<string> {
    actAs(owner);
    const created = await call("households", "POST", { body: { idempotencyKey: randomUUID(), name: `Home ${randomUUID().slice(0, 8)}` } });
    expect(created.status).toBe(201);
    const householdId = (created.json as { household: { id: string } }).household.id;
    const account = await call("financial-data/[section]", "POST", { params: { section: "accounts" },
      body: { idempotencyKey: randomUUID(), fields: { balance: { amount: "777.00", currency: "ILS" }, name: sharedName, type: "bank" } } });
    expect(account.status).toBe(201);
    const shared = await call("households/[householdId]/shares", "POST", { params: { householdId },
      body: { action: "share", expectedVersion: null, resourceId: (account.json as { record: { id: string } }).record.id, resourceKind: "account" } });
    expect(shared.status).toBe(200);
    return householdId;
  }
  async function invite(householdId: string): Promise<string> {
    actAs(owner);
    const invited = await call("households/[householdId]/invitations", "POST", { params: { householdId }, body: { email: MEMBER_EMAIL } });
    expect(invited.status).toBe(201);
    return (invited.json as { token: string }).token;
  }
  async function accept(token: string) { actAs(member); return call("households/invitations/accept", "POST", { body: { token } }); }
  const membership = (householdId: string) =>
    h.db.collection("householdMemberships").findOne({ householdId: new ObjectId(householdId), userId: new ObjectId(member.userId) });
  async function end(householdId: string, how: "removed" | "left") {
    const current = (await membership(householdId))!;
    if (how === "removed") {
      actAs(owner);
      expect((await call("households/[householdId]/members/[membershipId]", "DELETE", { params: { householdId, membershipId: String(current._id) }, body: { expectedVersion: current.version } })).status).toBe(200);
    } else {
      actAs(member);
      expect((await call("households/[householdId]/leave", "POST", { params: { householdId }, body: { expectedVersion: current.version } })).status).toBe(200);
    }
    actAs(member);
    expect((await call("households/[householdId]", "GET", { params: { householdId } })).status).toBe(404); // revocation is immediate
  }
  async function memberSeesHousehold(householdId: string) {
    actAs(member);
    const view = await call("households/[householdId]", "GET", { params: { householdId } });
    return view.status === 200 && view.text.includes(sharedName);
  }
  const expire = (householdId: string) =>
    h.db.collection("householdInvitations").updateMany({ householdId: new ObjectId(householdId) }, { $set: { expiresAt: new Date(Date.now() - 86_400_000) } });

  async function rejoinScenario(how: "removed" | "left") {
    {
      const householdId = await household();
      const token = await invite(householdId);
      expect((await accept(token)).status).toBe(200);                    // legitimate first acceptance
      expect(await memberSeesHousehold(householdId)).toBe(true);
      await end(householdId, how);

      await expectRefused(h.db, () => accept(token), [sharedName], [404]); // the exploit: same token
      await expire(householdId);
      await expectRefused(h.db, () => accept(token), [sharedName], [404]); // same token, now expired
      expect((await membership(householdId))!.status).toBe(how);
      expect(await memberSeesHousehold(householdId)).toBe(false);

      const fresh = await invite(householdId);                             // the intended rejoin path still works
      expect((await accept(fresh)).status).toBe(200);
      expect((await membership(householdId))!.status).toBe("active");
      expect(await memberSeesHousehold(householdId)).toBe(true);
    }
  }
  it("[iso-household-rejoin-removed] a removed member cannot replay the accepted token, even expired; a new invitation still works", () => rejoinScenario("removed"), 30_000);
  it("[iso-household-rejoin-left] a departed member cannot replay the accepted token, even expired; a new invitation still works", () => rejoinScenario("left"), 30_000);

  it("[iso-household-rejoin-older-token] after a second membership cycle, neither the first nor the second token restores access", async () => {
    const householdId = await household();
    const first = await invite(householdId);
    expect((await accept(first)).status).toBe(200);
    await end(householdId, "removed");
    const second = await invite(householdId);
    expect((await accept(second)).status).toBe(200);
    await end(householdId, "left");
    await expectRefused(h.db, () => accept(first), [sharedName], [404]);
    await expectRefused(h.db, () => accept(second), [sharedName], [404]);
    expect((await membership(householdId))!.status).toBe("left");
  }, 30_000);

  it("[iso-household-rejoin-race] the token that activated a membership can never reactivate it after it ended (atomic, race-proof)", async () => {
    // Deterministic form of the race: an acceptance still in flight reaches the repository AFTER the owner removed the member.
    const householdId = await household();
    const token = await invite(householdId);
    expect((await accept(token)).status).toBe(200);
    await end(householdId, "removed");
    const { householdRepositoryForDatabase } = await import("@/lib/households/household-repository");
    const repository = householdRepositoryForDatabase(h.db);
    const invitation = (await h.db.collection("householdInvitations").findOne({ householdId: new ObjectId(householdId) }))!;
    const accepted = await repository.findInvitationByTokenHash(invitation.tokenHash as string);
    const before = await membership(householdId);
    await expect(repository.activateMembership(accepted!, member.userId, "Synthetic")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await membership(householdId)).toEqual(before);
    expect(before!.status).toBe("removed");
  }, 30_000);

  it("[iso-household-reaccept-active] replaying the token while still active changes nothing (unchanged existing behaviour: 404)", async () => {
    const householdId = await household();
    const token = await invite(householdId);
    expect((await accept(token)).status).toBe(200);
    await expectRefused(h.db, () => accept(token), [], [404]);
    expect((await membership(householdId))!.status).toBe("active");
    expect(await memberSeesHousehold(householdId)).toBe(true);
  }, 30_000);

  it("[iso-household-accept-recovery] an acceptance whose activation never happened can still be completed with the same token", async () => {
    const householdId = await household();
    const token = await invite(householdId);
    // A crash between recording the acceptance (the real repository write) and activating the membership: no membership row.
    const pending = (await h.db.collection("householdInvitations").findOne({ householdId: new ObjectId(householdId), status: "pending" }))!;
    const { householdRepositoryForDatabase } = await import("@/lib/households/household-repository");
    await householdRepositoryForDatabase(h.db).markInvitationAccepted(String(pending._id), member.userId, pending.version as number);
    expect(await membership(householdId)).toBeNull();
    expect((await accept(token)).status).toBe(200);
    expect((await membership(householdId))!.status).toBe("active");
    expect(await memberSeesHousehold(householdId)).toBe(true);
  }, 30_000);
});

// Phase 18 row 18-14: household authorization through the REAL route handlers (synthetic data, isolated loopback MongoDB).
// Distinguishes authentication (every caller below is signed in) from household authorization: outsiders get nothing, members
// cannot perform owner actions or share someone else's resources, and household-scoped reads/searches/saved reports follow the
// CURRENT membership and share state on every request. Refusals disclose nothing and change no state.
import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, call, expectIsolated, expectRefused, marker, newActor, openHarness, type Called, type Harness } from "../security/route-harness";

vi.mock("@/lib/auth/actor", async () => (await import("../security/route-harness")).mockedActorModule());

const uri = process.env.MONGODB_TEST_URI;
const profile = { countryCode: "IL", displayName: "Synthetic", expectedVersion: null, householdType: "family", primaryCurrency: "ILS", timeZone: "Asia/Jerusalem" };
const ils = (amount: string) => ({ amount, currency: "ILS" });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed test-response JSON, navigated by the assertions below
const ok = (response: Called, status = 200) => { expect(response.status, response.text.slice(0, 300)).toBe(status); return response.json as Record<string, any>; };

(uri ? describe : describe.skip)("household authorization through real routes (18-14)", () => {
  let h: Harness;
  const owner = newActor(); const member = newActor(); const outsider = newActor();
  const m = { shared: marker("owner-shared"), unshared: marker("owner-unshared"), memberOwn: marker("member-own"), household: marker("household") };
  const markers = () => Object.values(m);
  let householdId = ""; let ownerShared = ""; let ownerUnshared = ""; let memberAccount = ""; let membershipId = ""; let pendingInvitationId = ""; let pendingToken = "";

  const account = async (name: string) => ok(await call("financial-data/[section]", "POST", { params: { section: "accounts" },
    body: { idempotencyKey: randomUUID(), fields: { balance: ils("100.00"), name, type: "bank" } } }), 201).record.id as string;

  beforeAll(async () => {
    h = await openHarness(uri!);
    for (const [actor, email] of [[owner, "owner@example.invalid"], [member, "member@example.invalid"], [outsider, "outsider@example.invalid"]] as const) {
      await h.db.collection("authUsers").insertOne({ _id: new ObjectId(actor.userId), email, name: email.split("@")[0] });
      actAs(actor); ok(await call("profile", "PUT", { body: profile }));
    }
    actAs(owner);
    householdId = ok(await call("households", "POST", { body: { idempotencyKey: randomUUID(), name: m.household } }), 201).household.id;
    ownerShared = await account(m.shared); ownerUnshared = await account(m.unshared);
    ok(await call("households/[householdId]/shares", "POST", { params: { householdId }, body: { action: "share", expectedVersion: null, resourceId: ownerShared, resourceKind: "account" } }));
    const token = ok(await call("households/[householdId]/invitations", "POST", { params: { householdId }, body: { email: "member@example.invalid" } }), 201).token as string;
    const pending = ok(await call("households/[householdId]/invitations", "POST", { params: { householdId }, body: { email: "someone-else@example.invalid" } }), 201);
    pendingInvitationId = pending.invitation.id; pendingToken = pending.token;
    actAs(member); ok(await call("households/invitations/accept", "POST", { body: { token } }));
    memberAccount = await account(m.memberOwn);
    membershipId = String((await h.db.collection("householdMemberships").findOne({ householdId: new ObjectId(householdId), userId: new ObjectId(member.userId) }))!._id);
  }, 120_000);
  afterAll(async () => { actAs(null); await h?.dispose(); });

  it("[iso-household-outsider] a signed-in outsider cannot read, change, invite into, share into, leave or report on the household", async () => {
    actAs(outsider);
    const list = await expectIsolated(h.db, () => call("households", "GET"), owner.userId, markers());
    expect(list.text).not.toContain(householdId);
    const p = { householdId };
    await expectRefused(h.db, () => call("households/[householdId]", "GET", { params: p }), markers(), [404]);
    await expectRefused(h.db, () => call("households/[householdId]", "PATCH", { params: p, body: { expectedVersion: 1, name: "taken" } }), markers(), [404]);
    await expectRefused(h.db, () => call("households/[householdId]", "DELETE", { params: p, body: { expectedVersion: 1 } }), markers(), [404]);
    await expectRefused(h.db, () => call("households/[householdId]/invitations", "POST", { params: p, body: { email: "friend@example.invalid" } }), markers(), [404]);
    await expectRefused(h.db, () => call("households/[householdId]/invitations/[invitationId]", "DELETE", { params: { householdId, invitationId: pendingInvitationId },
      body: { expectedVersion: 1 } }), markers(), [404]);
    await expectRefused(h.db, () => call("households/[householdId]/members/[membershipId]", "DELETE", { params: { householdId, membershipId }, body: { expectedVersion: 1 } }),
      markers(), [404]);
    await expectRefused(h.db, () => call("households/[householdId]/leave", "POST", { params: p, body: { expectedVersion: 1 } }), markers(), [404]);
    const own = await account("outsider account");
    await expectRefused(h.db, () => call("households/[householdId]/shares", "POST", { params: p, body: { action: "share", expectedVersion: null, resourceId: own,
      resourceKind: "account" } }), markers(), [404]);
    await expectRefused(h.db, () => call("reports", "GET", { query: { periodKind: "month", periodValue: "2026-09", scopeKind: "household", householdId } }), markers(), [404]);
    await expectRefused(h.db, () => call("reports/export", "GET", { query: { format: "json", periodKind: "month", periodValue: "2026-09", scopeKind: "household", householdId } }),
      markers(), [404]);
    await expectRefused(h.db, () => call("reports", "POST", { body: { action: "close", idempotencyKey: randomUUID(), period: { kind: "month", value: "2026-09" },
      scope: { householdId, kind: "household" } } }), markers(), [404]);
    await expectRefused(h.db, () => call("search", "GET", { query: { query: m.shared.slice(0, 20), scopeKind: "household", householdId } }), markers(), [404]);
    await expectRefused(h.db, () => call("households/invitations/accept", "POST", { body: { token: pendingToken } }), markers(), [404]); // bound to another email
  });

  it("[iso-household-member-role] a member sees only shared data and cannot perform owner actions or share someone else's resource", async () => {
    actAs(member);
    const view = ok(await call("households/[householdId]", "GET", { params: { householdId } }));
    expect(JSON.stringify(view)).toContain(m.shared); expect(JSON.stringify(view)).not.toContain(m.unshared);
    const report = await call("reports", "GET", { query: { periodKind: "month", periodValue: "2026-09", scopeKind: "household", householdId } });
    expect(report.status).toBe(200); expect(report.text).not.toContain(m.unshared);
    const p = { householdId }; const hidden = [m.unshared];
    await expectRefused(h.db, () => call("households/[householdId]", "PATCH", { params: p, body: { expectedVersion: 1, name: "taken" } }), hidden, [404]);
    await expectRefused(h.db, () => call("households/[householdId]", "DELETE", { params: p, body: { expectedVersion: 1 } }), hidden, [404]);
    await expectRefused(h.db, () => call("households/[householdId]/invitations", "POST", { params: p, body: { email: "friend@example.invalid" } }), hidden, [404]);
    await expectRefused(h.db, () => call("households/[householdId]/invitations/[invitationId]", "DELETE", { params: { householdId, invitationId: pendingInvitationId },
      body: { expectedVersion: 1 } }), hidden, [404]);
    await expectRefused(h.db, () => call("households/[householdId]/members/[membershipId]", "DELETE", { params: { householdId, membershipId }, body: { expectedVersion: 1 } }),
      hidden, [404]);
    for (const resourceId of [ownerUnshared, ownerShared]) {
      await expectRefused(h.db, () => call("households/[householdId]/shares", "POST", { params: p, body: { action: "share", expectedVersion: null, resourceId,
        resourceKind: "account" } }), hidden, [404, 409]);
      await expectRefused(h.db, () => call("households/[householdId]/shares", "POST", { params: p, body: { action: "unshare", expectedVersion: 1, resourceId,
        resourceKind: "account" } }), hidden, [404, 409]);
    }
    // The owner, in turn, never sees the member's unshared account.
    actAs(owner);
    const ownerView = ok(await call("households/[householdId]", "GET", { params: p }));
    expect(JSON.stringify(ownerView)).not.toContain(m.memberOwn);
    expect(memberAccount).toMatch(/^[0-9a-f]{24}$/);
  });

  it("[iso-household-unshare] unsharing hides the resource from the household view, report and saved report immediately", async () => {
    actAs(member);
    const saved = ok(await call("reports", "POST", { body: { action: "close", idempotencyKey: randomUUID(), period: { kind: "month", value: "2026-09" },
      scope: { householdId, kind: "household" } } }), 201).report.id as string;
    expect((await call("reports/[reportId]", "GET", { params: { reportId: saved } })).text).toContain(m.shared);
    actAs(owner);
    const share = (await h.db.collection("householdResourceShares").findOne({ householdId: new ObjectId(householdId), resourceId: new ObjectId(ownerShared) }))!;
    ok(await call("households/[householdId]/shares", "POST", { params: { householdId }, body: { action: "unshare", expectedVersion: share.version, resourceId: ownerShared,
      resourceKind: "account" } }));
    actAs(member);
    expect(JSON.stringify(ok(await call("households/[householdId]", "GET", { params: { householdId } })))).not.toContain(m.shared);
    await expectRefused(h.db, () => call("reports/[reportId]", "GET", { params: { reportId: saved } }), [m.shared, m.unshared], [404]);
    await expectRefused(h.db, () => call("reports/export", "GET", { query: { format: "csv", snapshotId: saved } }), [m.shared, m.unshared], [404]);
    // Re-share for the next test.
    actAs(owner);
    const again = (await h.db.collection("householdResourceShares").findOne({ _id: share._id }))!;
    ok(await call("households/[householdId]/shares", "POST", { params: { householdId }, body: { action: "share", expectedVersion: again.version, resourceId: ownerShared,
      resourceKind: "account" } }));
  });

  it("[iso-household-removal] removal is immediate for the household view, reports, exports, searches and saved household reports", async () => {
    actAs(member);
    const saved = ok(await call("reports", "POST", { body: { action: "close", idempotencyKey: randomUUID(), period: { kind: "month", value: "2026-08" },
      scope: { householdId, kind: "household" } } }), 201).report.id as string;
    actAs(owner);
    const current = (await h.db.collection("householdMemberships").findOne({ _id: new ObjectId(membershipId) }))!;
    ok(await call("households/[householdId]/members/[membershipId]", "DELETE", { params: { householdId, membershipId }, body: { expectedVersion: current.version } }));
    actAs(member);
    const p = { householdId }; const hidden = [m.shared, m.unshared];
    await expectRefused(h.db, () => call("households/[householdId]", "GET", { params: p }), hidden, [404]);
    await expectRefused(h.db, () => call("reports", "GET", { query: { periodKind: "month", periodValue: "2026-09", scopeKind: "household", householdId } }), hidden, [404]);
    await expectRefused(h.db, () => call("reports/[reportId]", "GET", { params: { reportId: saved } }), hidden, [404]);
    await expectRefused(h.db, () => call("reports/export", "GET", { query: { format: "json", snapshotId: saved } }), hidden, [404]);
    await expectRefused(h.db, () => call("search", "GET", { query: { query: m.shared.slice(0, 20), scopeKind: "household", householdId } }), hidden, [404]);
    await expectRefused(h.db, () => call("households/[householdId]/shares", "POST", { params: p, body: { action: "share", expectedVersion: null, resourceId: memberAccount,
      resourceKind: "account" } }), hidden, [404]);
    const listed = await expectIsolated(h.db, () => call("households", "GET"), owner.userId, hidden);
    expect(listed.text).not.toContain(householdId);
    const savedList = await call("reports", "GET", { query: { periodKind: "month", periodValue: "2026-09", scopeKind: "personal" } });
    expect(savedList.status).toBe(200); expect(savedList.text).not.toContain(saved);
  });

  it("[iso-household-dissolve] after dissolution nobody but the record remains: the household is unreachable for its former owner and members", async () => {
    actAs(owner);
    const household = (await h.db.collection("households").findOne({ _id: new ObjectId(householdId) }))!;
    ok(await call("households/[householdId]", "DELETE", { params: { householdId }, body: { expectedVersion: household.version } }));
    for (const actor of [owner, member]) {
      actAs(actor);
      await expectRefused(h.db, () => call("households/[householdId]", "GET", { params: { householdId } }), [m.shared, m.unshared], [404]);
    }
  });
});

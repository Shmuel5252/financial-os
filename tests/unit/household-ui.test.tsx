import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HouseholdCenter } from "@/components/households/household-center";
import type { HouseholdCenterView } from "@/lib/households/household";
import { messages } from "@/lib/i18n";

const householdId = "a".repeat(24);
const accountId = "b".repeat(24);

const populatedView: HouseholdCenterView = {
  audit: [
    {
      action: "resource_shared",
      actorLabel: "שמואל",
      at: "2026-09-01T12:00:00.000Z",
      resourceLabel: "חשבון משותף",
      targetLabel: null,
    },
  ],
  eligibleResources: [
    {
      label: "חשבון שוטף",
      resourceId: accountId,
      resourceKind: "account",
      shareId: "c".repeat(24),
      shareVersion: 1,
      shared: true,
    },
  ],
  households: [
    {
      createdAt: "2026-09-01T10:00:00.000Z",
      id: householdId,
      memberCount: 2,
      name: "הבית שלנו",
      role: "owner",
      version: 2,
    },
  ],
  invitations: [
    {
      createdAt: "2026-09-01T11:00:00.000Z",
      expiresAt: "2026-09-08T11:00:00.000Z",
      id: "d".repeat(24),
      inviteeHint: "m***@example.com",
      status: "pending",
      version: 1,
    },
  ],
  members: [
    {
      displayName: "שמואל",
      isCurrentActor: true,
      joinedAt: "2026-09-01T10:00:00.000Z",
      membershipId: null,
      role: "owner",
      version: 2,
    },
    {
      displayName: "נועה",
      isCurrentActor: false,
      joinedAt: "2026-09-01T11:30:00.000Z",
      membershipId: "e".repeat(24),
      role: "member",
      version: 1,
    },
  ],
  selected: {
    createdAt: "2026-09-01T10:00:00.000Z",
    id: householdId,
    memberCount: 2,
    name: "הבית שלנו",
    role: "owner",
    version: 2,
  },
  sharedAccounts: [
    {
      balance: { amountMinor: "123456", currency: "ILS" },
      label: "חשבון שוטף",
      ownerLabel: "שמואל",
      provenanceAlias: "household.account.1",
    },
  ],
  sharedGoals: [],
  totals: [
    {
      amount: { amountMinor: "123456", currency: "ILS" },
      contributionCount: 1,
    },
  ],
};

describe("Phase 11 Hebrew/RTL household experience", () => {
  it("renders natural Hebrew and isolates inherently LTR values", () => {
    const html = renderToStaticMarkup(<HouseholdCenter initialView={populatedView} />);
    expect(html).toContain(messages.households.privacy);
    expect(html).toContain(messages.households.actions.unshare);
    expect(html).toContain(messages.households.audit.actions.resource_shared);
    expect(html).toContain("הבית שלנו");
    expect(html).toContain("1234.56 ILS");
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("m***@example.com");
    expect(html).not.toContain("userId");
    expect(html).not.toContain("ownerUserId");
  });

  it("renders explicit private-by-default and no-household states", () => {
    const html = renderToStaticMarkup(
      <HouseholdCenter
        initialView={{
          audit: [],
          eligibleResources: [],
          households: [],
          invitations: [],
          members: [],
          selected: null,
          sharedAccounts: [],
          sharedGoals: [],
          totals: [],
        }}
      />,
    );
    expect(html).toContain(messages.households.create.description);
    expect(html).toContain(messages.households.empty);
    expect(html).toContain(messages.households.invitations.acceptDescription);
  });
});

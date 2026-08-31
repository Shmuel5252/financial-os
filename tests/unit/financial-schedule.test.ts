import { describe, expect, it } from "vitest";

import { expandRecurrence } from "@/lib/domain/financial-engine/financial-schedule";

describe("financial recurrence expansion", () => {
  it("preserves the original monthly anchor while clamping short months", () => {
    expect(
      expandRecurrence(
        {
          endDate: null,
          frequency: "monthly",
          interval: 1,
          startDate: "2027-01-31",
        },
        "2027-01-01",
        "2027-04-30",
      ),
    ).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("handles leap years, recurrence intervals, end dates, and bounded horizons", () => {
    expect(
      expandRecurrence(
        {
          endDate: "2028-03-01",
          frequency: "annual",
          interval: 1,
          startDate: "2024-02-29",
        },
        "2025-01-01",
        "2029-12-31",
      ),
    ).toEqual(["2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
    expect(
      expandRecurrence(
        {
          endDate: null,
          frequency: "weekly",
          interval: 2,
          startDate: "2026-08-01",
        },
        "2026-08-10",
        "2026-08-31",
      ),
    ).toEqual(["2026-08-15", "2026-08-29"]);
  });

  it("emits irregular and one-time schedules once and rejects invalid ranges", () => {
    expect(
      expandRecurrence(
        {
          endDate: null,
          frequency: "irregular",
          interval: 1,
          startDate: "2026-09-15",
        },
        "2026-09-01",
        "2026-09-30",
      ),
    ).toEqual(["2026-09-15"]);
    expect(() =>
      expandRecurrence(
        {
          endDate: null,
          frequency: "monthly",
          interval: 1,
          startDate: "2026-09-01",
        },
        "2026-10-01",
        "2026-09-01",
      ),
    ).toThrow(/horizon/);
  });
});

import { describe, expect, it } from "vitest";

import {
  calendarDateSchema,
  ianaTimeZoneSchema,
  utcInstantSchema,
} from "@/lib/domain/time/financial-time";

describe("financial time validation", () => {
  it("accepts real calendar dates without converting them to instants", () => {
    expect(calendarDateSchema.parse("2028-02-29")).toBe("2028-02-29");
  });

  it.each(["2027-02-29", "2026-13-01", "2026-00-10", "30/08/2026"])(
    "rejects invalid calendar date %s",
    (value) => {
      expect(calendarDateSchema.safeParse(value).success).toBe(false);
    },
  );

  it("accepts UTC instants and rejects non-UTC offsets", () => {
    expect(utcInstantSchema.parse("2026-08-30T14:30:00.000Z")).toBe(
      "2026-08-30T14:30:00.000Z",
    );
    expect(
      utcInstantSchema.safeParse("2026-08-30T17:30:00+03:00").success,
    ).toBe(false);
  });

  it("validates IANA timezone identifiers", () => {
    expect(ianaTimeZoneSchema.parse("Asia/Jerusalem")).toBe("Asia/Jerusalem");
    expect(ianaTimeZoneSchema.safeParse("Jerusalem Local Time").success).toBe(
      false,
    );
  });
});

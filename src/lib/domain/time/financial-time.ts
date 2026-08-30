import { z } from "zod";

const CALENDAR_DATE_PATTERN = /^([1-9]\d{3})-(\d{2})-(\d{2})$/;

function isRealCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE_PATTERN.exec(value);

  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, month - 1, day));

  return (
    instant.getUTCFullYear() === year &&
    instant.getUTCMonth() === month - 1 &&
    instant.getUTCDate() === day
  );
}

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const calendarDateSchema = z
  .string()
  .regex(CALENDAR_DATE_PATTERN)
  .refine(isRealCalendarDate, "Expected a real calendar date.");

export const utcInstantSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => value.endsWith("Z"), "Expected a UTC instant ending in Z.");

export const ianaTimeZoneSchema = z
  .string()
  .min(1)
  .refine(isIanaTimeZone, "Expected a valid IANA timezone.");

export type CalendarDate = z.infer<typeof calendarDateSchema>;
export type UtcInstant = z.infer<typeof utcInstantSchema>;
export type IanaTimeZone = z.infer<typeof ianaTimeZoneSchema>;

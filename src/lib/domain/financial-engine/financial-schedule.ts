import {
  addCalendarDays,
  addCalendarMonthsClamped,
  compareCalendarDates,
} from "@/lib/domain/financial-engine/financial-calendar";
import type { CalendarDate } from "@/lib/domain/time/financial-time";

export type RecurrenceFrequency =
  | "annual"
  | "biweekly"
  | "irregular"
  | "monthly"
  | "one_time"
  | "quarterly"
  | "weekly";

export type Recurrence = Readonly<{
  endDate: CalendarDate | null;
  frequency: RecurrenceFrequency;
  interval: number;
  startDate: CalendarDate;
}>;

function occurrenceAt(
  recurrence: Recurrence,
  occurrenceIndex: number,
): CalendarDate {
  const step = occurrenceIndex * recurrence.interval;

  switch (recurrence.frequency) {
    case "weekly":
      return addCalendarDays(recurrence.startDate, step * 7);
    case "biweekly":
      return addCalendarDays(recurrence.startDate, step * 14);
    case "monthly":
      return addCalendarMonthsClamped(recurrence.startDate, step);
    case "quarterly":
      return addCalendarMonthsClamped(recurrence.startDate, step * 3);
    case "annual":
      return addCalendarMonthsClamped(recurrence.startDate, step * 12);
    case "irregular":
    case "one_time":
      return recurrence.startDate;
  }
}

export function expandRecurrence(
  recurrence: Recurrence,
  horizonStart: CalendarDate,
  horizonEnd: CalendarDate,
): readonly CalendarDate[] {
  if (!Number.isInteger(recurrence.interval) || recurrence.interval < 1) {
    throw new RangeError("Recurrence interval must be a positive integer.");
  }
  if (compareCalendarDates(horizonStart, horizonEnd) > 0) {
    throw new RangeError("Recurrence horizon is invalid.");
  }
  if (
    recurrence.endDate !== null &&
    compareCalendarDates(recurrence.endDate, recurrence.startDate) < 0
  ) {
    throw new RangeError("Recurrence end date precedes its start date.");
  }

  if (
    recurrence.frequency === "irregular" ||
    recurrence.frequency === "one_time"
  ) {
    return recurrence.startDate >= horizonStart &&
      recurrence.startDate <= horizonEnd &&
      (recurrence.endDate === null || recurrence.startDate <= recurrence.endDate)
      ? [recurrence.startDate]
      : [];
  }

  const dates: CalendarDate[] = [];
  // A 366-day engine horizon cannot produce more than 367 daily-equivalent
  // occurrences. This defensive cap also prevents malformed recurrence loops.
  let terminated = false;
  for (let occurrenceIndex = 0; occurrenceIndex <= 10_000; occurrenceIndex += 1) {
    const occurrence = occurrenceAt(recurrence, occurrenceIndex);

    if (recurrence.endDate !== null && occurrence > recurrence.endDate) {
      terminated = true;
      break;
    }
    if (occurrence > horizonEnd) {
      terminated = true;
      break;
    }
    if (occurrence >= horizonStart) {
      dates.push(occurrence);
    }
  }

  if (!terminated) {
    throw new RangeError("Recurrence expansion exceeded its safety bound.");
  }

  return dates;
}

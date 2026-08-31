import {
  calendarDateSchema,
  ianaTimeZoneSchema,
  utcInstantSchema,
  type CalendarDate,
} from "@/lib/domain/time/financial-time";

type CalendarParts = Readonly<{ day: number; month: number; year: number }>;

function parts(value: string): CalendarParts {
  const parsed = calendarDateSchema.parse(value);
  const [year, month, day] = parsed.split("-").map(Number);

  if (year === undefined || month === undefined || day === undefined) {
    throw new RangeError("Invalid calendar date.");
  }

  return { day, month, year };
}

function format({ day, month, year }: CalendarParts): CalendarDate {
  return calendarDateSchema.parse(
    `${year.toString().padStart(4, "0")}-${month
      .toString()
      .padStart(2, "0")}-${day.toString().padStart(2, "0")}`,
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function calendarDateAtInstant(
  instant: string,
  timeZone: string,
): CalendarDate {
  const validatedInstant = utcInstantSchema.parse(instant);
  const validatedTimeZone = ianaTimeZoneSchema.parse(timeZone);
  const dateParts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: validatedTimeZone,
    year: "numeric",
  }).formatToParts(new Date(validatedInstant));
  const value = Object.fromEntries(
    dateParts.map((part) => [part.type, part.value]),
  );

  return calendarDateSchema.parse(
    `${value.year}-${value.month}-${value.day}`,
  );
}

export function addCalendarDays(
  value: CalendarDate,
  count: number,
): CalendarDate {
  if (!Number.isInteger(count)) {
    throw new RangeError("Calendar-day count must be an integer.");
  }

  const source = parts(value);
  const date = new Date(
    Date.UTC(source.year, source.month - 1, source.day + count),
  );

  return format({
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  });
}

export function addCalendarMonthsClamped(
  value: CalendarDate,
  count: number,
): CalendarDate {
  if (!Number.isInteger(count)) {
    throw new RangeError("Calendar-month count must be an integer.");
  }

  const source = parts(value);
  const target = new Date(Date.UTC(source.year, source.month - 1 + count, 1));
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth() + 1;

  return format({
    day: Math.min(source.day, daysInMonth(year, month)),
    month,
    year,
  });
}

export function calendarMonth(value: CalendarDate): string {
  return calendarDateSchema.parse(value).slice(0, 7);
}

export function firstCalendarDateOfMonth(value: CalendarDate): CalendarDate {
  const source = parts(value);
  return format({ ...source, day: 1 });
}

export function lastCalendarDateOfMonth(value: CalendarDate): CalendarDate {
  const source = parts(value);
  return format({
    ...source,
    day: daysInMonth(source.year, source.month),
  });
}

export function nextCalendarMonthStart(value: CalendarDate): CalendarDate {
  return addCalendarMonthsClamped(firstCalendarDateOfMonth(value), 1);
}

export function compareCalendarDates(
  left: CalendarDate,
  right: CalendarDate,
): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

export function isCalendarDateWithin(
  value: CalendarDate,
  start: CalendarDate,
  end: CalendarDate,
): boolean {
  return value >= start && value <= end;
}

export function billingDateOnOrAfter(
  start: CalendarDate,
  billingDay: number,
): CalendarDate {
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) {
    throw new RangeError("Billing day must be between 1 and 31.");
  }

  const source = parts(start);
  const candidate = format({
    day: Math.min(billingDay, daysInMonth(source.year, source.month)),
    month: source.month,
    year: source.year,
  });

  if (candidate >= start) {
    return candidate;
  }

  const nextMonth = addCalendarMonthsClamped(
    firstCalendarDateOfMonth(start),
    1,
  );
  const next = parts(nextMonth);
  return format({
    day: Math.min(billingDay, daysInMonth(next.year, next.month)),
    month: next.month,
    year: next.year,
  });
}

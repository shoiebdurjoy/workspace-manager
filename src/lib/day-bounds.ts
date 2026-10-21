/**
 * The viewer's calendar day, for anything that asks the database about today (Home): the start of today,
 * of tomorrow, and the end of "next 7 days" (days 1 to 7 after today), all in local time.
 */
export interface DayBounds {
  dayStart: Date;
  dayEnd: Date;
  weekEnd: Date;
}

/** The viewer's today, tomorrow and the end of "next 7 days" (days 1 to 7 after today), in local time. */
export function dayBounds(now: Date = new Date()): DayBounds {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 8);
  return { dayStart, dayEnd, weekEnd };
}

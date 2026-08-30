export function toDateOnly(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${String(value)}`);
  }

  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(value: string | Date, days: number): string {
  const dateOnly = toDateOnly(value);
  const [year, month, day] = dateOnly.split("-").map(Number);

  if (!year || !month || !day) {
    throw new Error(`Invalid date-only value: ${dateOnly}`);
  }

  const result = new Date(Date.UTC(year, month - 1, day + days));

  return result.toISOString().slice(0, 10);
}

export function compareDateOnly(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

export function isOnOrBeforeDate(value: string | Date, deadline: string): boolean {
  return compareDateOnly(toDateOnly(value), deadline) <= 0;
}

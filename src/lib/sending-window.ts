export function zonedClock(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = (parts.find((part) => part.type === "hour")?.value ?? "00").padStart(2, "0");
  const minute = (parts.find((part) => part.type === "minute")?.value ?? "00").padStart(2, "0");
  return `${hour}:${minute}`;
}

export function isWithinSendingWindow(now: Date, timeZone: string, start: string, end: string): boolean {
  const current = zonedClock(now, timeZone);
  return current >= start && current < end;
}

export function startOfDayInTimeZone(now: Date, timeZone: string): Date {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const utcMidnight = new Date(`${day}T00:00:00.000Z`);
  const offset = timeZoneOffsetMs(utcMidnight, timeZone);
  return new Date(utcMidnight.getTime() - offset);
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour") % 24, value("minute"), value("second"));
  return asUtc - date.getTime();
}

export function leadStatusAfterSend(current: string): string | null {
  return current === "NEW" ? "CONTACTED" : null;
}

export function leadStatusAfterReply(current: string): string | null {
  return current === "NEW" || current === "CONTACTED" ? "RESPONDED" : null;
}

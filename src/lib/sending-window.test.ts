import assert from "node:assert/strict";
import test from "node:test";
import { isWithinSendingWindow, leadStatusAfterReply, leadStatusAfterSend, startOfDayInTimeZone } from "./sending-window";

test("uses the campaign timezone for the sending window", () => {
  const noonUtc = new Date("2026-09-29T12:00:00.000Z");
  assert.equal(isWithinSendingWindow(noonUtc, "UTC", "08:00", "17:00"), true);
  assert.equal(isWithinSendingWindow(noonUtc, "UTC", "13:00", "17:00"), false);
  assert.equal(isWithinSendingWindow(noonUtc, "Africa/Johannesburg", "13:00", "17:00"), true);
});

test("starts the daily quota at local midnight", () => {
  const noonUtc = new Date("2026-09-29T12:00:00.000Z");
  assert.equal(startOfDayInTimeZone(noonUtc, "UTC").toISOString(), "2026-09-29T00:00:00.000Z");
  assert.equal(startOfDayInTimeZone(noonUtc, "Africa/Johannesburg").toISOString(), "2026-09-28T22:00:00.000Z");
});

test("advances lead status only forward", () => {
  assert.equal(leadStatusAfterSend("NEW"), "CONTACTED");
  assert.equal(leadStatusAfterSend("QUALIFIED"), null);
  assert.equal(leadStatusAfterReply("CONTACTED"), "RESPONDED");
  assert.equal(leadStatusAfterReply("WON"), null);
});

import { TimeBucket } from "../types/otp";

const DAY_MS = 24 * 60 * 60 * 1000;

export const toEpochMs = (timestamp: number) =>
  timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;

export const getTimeBucket = (eventTimestamp: number, now = Date.now()): TimeBucket => {
  const eventMs = toEpochMs(eventTimestamp);
  const eventDate = new Date(eventMs);
  const nowDate = new Date(now);

  const sameUtcDay =
    eventDate.getUTCFullYear() === nowDate.getUTCFullYear() &&
    eventDate.getUTCMonth() === nowDate.getUTCMonth() &&
    eventDate.getUTCDate() === nowDate.getUTCDate();

  if (sameUtcDay) {
    return "TODAY";
  }

  if (eventMs <= now + 7 * DAY_MS) {
    return "WEEKLY";
  }

  return "MONTHLY";
};

import Redis, { Redis as RedisClient } from "ioredis";
import { env } from "../config/env";

export const redis: RedisClient = new Redis(env.redisUrl, {
  maxRetriesPerRequest: 3,
  enableAutoPipelining: true,
  lazyConnect: env.nodeEnv === "test"
});

redis.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("Redis error", err);
});

export const getRedis = () => redis;

export const redisKeys = {
  selections: (userId: string) => `otp:user:${userId}:selections`,
  selectionIndex: (userId: string) => `otp:user:${userId}:selection-index`,
  locks: (userId: string) => `otp:user:${userId}:locks`,
  contextMap: "otp:context-map",
  idempotency: (userId: string, key: string) => `otp:idem:${userId}:${key}`,
  rateLimit: (apiKey: string, window: number) => `otp:ratelimit:${apiKey}:${window}`
};

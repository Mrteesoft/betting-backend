import { env } from "../config/env";
import { redis, redisKeys } from "./redis";

export const checkRateLimit = async (apiKey: string) => {
  const window = Math.floor(Date.now() / 60000);
  const key = redisKeys.rateLimit(apiKey, window);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 60);
  }
  if (count > env.rateLimitPerMinute) {
    const err = Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 });
    throw err;
  }
};

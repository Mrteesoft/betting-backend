import { env } from "../config/env";
import { stateKeys, stateStore } from "./stateStore";

export const checkRateLimit = async (apiKey: string) => {
  const window = Math.floor(Date.now() / 60000);
  const key = stateKeys.rateLimit(apiKey, window);
  const count = await stateStore.incr(key);
  if (count === 1) {
    await stateStore.expire(key, 60);
  }
  if (count > env.rateLimitPerMinute) {
    const err = Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 });
    throw err;
  }
};

import { redis, redisKeys } from "./redis";
import { env } from "../config/env";

const PENDING = "__pending__";

export const withIdempotency = async <T>(
  userId: string,
  key: string,
  compute: () => Promise<T>
): Promise<T> => {
  const idemKey = redisKeys.idempotency(userId, key);

  const existing = await redis.get(idemKey);
  if (existing && existing !== PENDING) {
    return JSON.parse(existing) as T;
  }

  const setResult = await redis.set(idemKey, PENDING, "EX", env.idempotencyTtlSec, "NX");
  if (setResult === null) {
    // another request is processing or value exists; try to read again
    const val = await redis.get(idemKey);
    if (val && val !== PENDING) {
      return JSON.parse(val) as T;
    }
    throw Object.assign(new Error("Request is already processing"), { statusCode: 409 });
  }

  const result = await compute();
  await redis.set(idemKey, JSON.stringify(result), "EX", env.idempotencyTtlSec);
  return result;
};

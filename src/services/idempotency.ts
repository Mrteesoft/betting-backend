import { stateKeys, stateStore } from "./stateStore";
import { env } from "../config/env";

const PENDING = "__pending__";

export const withIdempotency = async <T>(
  userId: string,
  key: string,
  compute: () => Promise<T>
): Promise<T> => {
  const idemKey = stateKeys.idempotency(userId, key);

  const existing = await stateStore.get(idemKey);
  if (existing && existing !== PENDING) {
    return JSON.parse(existing) as T;
  }

  const setResult = await stateStore.set(idemKey, PENDING, "EX", env.idempotencyTtlSec, "NX");
  if (setResult === null) {
    // another request is processing or value exists; try to read again
    const val = await stateStore.get(idemKey);
    if (val && val !== PENDING) {
      return JSON.parse(val) as T;
    }
    throw Object.assign(new Error("Request is already processing"), { statusCode: 409 });
  }

  const result = await compute();
  await stateStore.set(idemKey, JSON.stringify(result), "EX", env.idempotencyTtlSec);
  return result;
};

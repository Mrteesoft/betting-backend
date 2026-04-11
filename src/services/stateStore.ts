import { MemoryStore, StoreLike } from "./memoryStore";

export const stateStore: StoreLike = new MemoryStore();

export const stateKeys = {
  selections: (userId: string) => `otp:user:${userId}:selections`,
  selectionIndex: (userId: string) => `otp:user:${userId}:selection-index`,
  locks: (userId: string) => `otp:user:${userId}:locks`,
  contextMap: "otp:context-map",
  idempotency: (userId: string, key: string) => `otp:idem:${userId}:${key}`,
  rateLimit: (apiKey: string, window: number) => `otp:ratelimit:${apiKey}:${window}`
};

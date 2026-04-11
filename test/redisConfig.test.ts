import { describe, expect, it } from "vitest";
import { resolveRedisUrl, usesRedisTls } from "../src/config/redisConfig";

describe("redisConfig", () => {
  it("falls back to localhost outside production", () => {
    expect(resolveRedisUrl({ nodeEnv: "development" })).toBe("redis://localhost:6379");
  });

  it("requires an explicit redis url in production", () => {
    expect(() => resolveRedisUrl({ nodeEnv: "production" })).toThrow(/REDIS_URL is required in production/i);
  });

  it("rejects localhost redis urls in production", () => {
    expect(() => resolveRedisUrl({
      nodeEnv: "production",
      redisUrl: "redis://127.0.0.1:6379"
    })).toThrow(/cannot point to localhost in production/i);
  });

  it("accepts managed redis urls in production", () => {
    expect(resolveRedisUrl({
      nodeEnv: "production",
      redisUrl: "rediss://default:secret@redis.internal:6379"
    })).toBe("rediss://default:secret@redis.internal:6379");
  });

  it("detects tls redis urls", () => {
    expect(usesRedisTls("rediss://default:secret@redis.internal:6379")).toBe(true);
    expect(usesRedisTls("redis://localhost:6379")).toBe(false);
  });
});

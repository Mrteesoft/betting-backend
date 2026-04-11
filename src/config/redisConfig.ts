const LOCAL_REDIS_URL_PATTERN = /^redis(s)?:\/\/(?:(?:[^@/]+)@)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i;

type ResolveRedisUrlInput = {
  nodeEnv: "development" | "test" | "production";
  redisUrl?: string;
  redisTlsUrl?: string;
};

const normaliseRedisUrl = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const resolveRedisUrl = (input: ResolveRedisUrlInput) => {
  const explicitUrl = normaliseRedisUrl(input.redisUrl) ?? normaliseRedisUrl(input.redisTlsUrl);
  const fallbackUrl = input.nodeEnv === "production" ? undefined : "redis://localhost:6379";
  const redisUrl = explicitUrl ?? fallbackUrl;

  if (!redisUrl) {
    throw new Error(
      "REDIS_URL is required in production. Set it to your managed Redis internal URL (for Render, use your Key Value internal connection string)."
    );
  }

  if (input.nodeEnv === "production" && LOCAL_REDIS_URL_PATTERN.test(redisUrl)) {
    throw new Error(
      "REDIS_URL cannot point to localhost in production. Set it to your managed Redis internal URL instead."
    );
  }

  return redisUrl;
};

export const usesRedisTls = (redisUrl: string) => redisUrl.startsWith("rediss://");

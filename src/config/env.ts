import { z } from "zod";
import { loadLocalEnv } from "./loadEnv";
import { resolveRedisUrl } from "./redisConfig";

loadLocalEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().default("3000"),
  REDIS_URL: z.string().optional(),
  REDIS_TLS_URL: z.string().optional(),
  API_KEYS: z.string().default("local-dev-key"),
  RATE_LIMIT_PER_MINUTE: z.string().default("120"),
  CONTEXT_CACHE_TTL_MS: z.string().default("60000"),
  IDEMPOTENCY_TTL_SEC: z.string().default("600"),
  CLUSTER_ENABLED: z.string().optional(),
  ANCHOR_PARTNER_API_KEY: z.string().optional(),
  OTS_EXCLUSIVE_TO_ANCHOR: z.string().optional(),
  HIGHLIGHTLY_FOOTBALL_KEY: z.string().optional(),
  HIGHLIGHTLY_FOOTBALL_BASE_URL: z.string().optional(),
  HIGHLIGHTLY_FOOTBALL_TIMEZONE: z.string().optional(),
  HIGHLIGHTLY_FOOTBALL_CACHE_TTL_MS: z.string().optional(),
  HIGHLIGHTLY_FOOTBALL_FIXTURE_LIMIT: z.string().optional(),
  HIGHLIGHTLY_FOOTBALL_LOOKAHEAD_DAYS: z.string().optional(),
  HIGHLIGHTLY_FOOTBALL_BOOKMAKER_ID: z.string().optional(),
  HIGHLIGHTLY_FOOTBALL_ODDS_ENABLED: z.string().optional(),
  HIGHLIGHTLY_FOOTBALL_TIMEOUT_MS: z.string().optional(),
  API_FOOTBALL_KEY: z.string().optional(),
  API_FOOTBALL_BASE_URL: z.string().optional(),
  API_FOOTBALL_TIMEZONE: z.string().optional(),
  API_FOOTBALL_CACHE_TTL_MS: z.string().optional(),
  API_FOOTBALL_FIXTURE_LIMIT: z.string().optional(),
  API_FOOTBALL_ODDS_LOOKAHEAD_DAYS: z.string().optional(),
  API_FOOTBALL_BOOKMAKER_ID: z.string().optional(),
  API_FOOTBALL_TIMEOUT_MS: z.string().optional()
});

const parsed = envSchema.parse(process.env);

export const env = {
  nodeEnv: parsed.NODE_ENV,
  port: Number(parsed.PORT),
  redisUrl: resolveRedisUrl({
    nodeEnv: parsed.NODE_ENV,
    redisUrl: parsed.REDIS_URL,
    redisTlsUrl: parsed.REDIS_TLS_URL
  }),
  apiKeys: parsed.API_KEYS.split(",").map((s) => s.trim()).filter(Boolean),
  rateLimitPerMinute: Number(parsed.RATE_LIMIT_PER_MINUTE),
  contextCacheTtlMs: Number(parsed.CONTEXT_CACHE_TTL_MS),
  idempotencyTtlSec: Number(parsed.IDEMPOTENCY_TTL_SEC),
  clusterEnabled: parsed.CLUSTER_ENABLED === "true",
  anchorPartnerApiKey: parsed.ANCHOR_PARTNER_API_KEY?.trim(),
  otsExclusiveToAnchor: parsed.OTS_EXCLUSIVE_TO_ANCHOR === "true",
  footballDataKey: parsed.HIGHLIGHTLY_FOOTBALL_KEY?.trim() ?? parsed.API_FOOTBALL_KEY?.trim(),
  footballDataBaseUrl: (
    parsed.HIGHLIGHTLY_FOOTBALL_BASE_URL ??
    parsed.API_FOOTBALL_BASE_URL ??
    "https://soccer.highlightly.net"
  ).replace(/\/+$/, ""),
  footballDataTimezone: parsed.HIGHLIGHTLY_FOOTBALL_TIMEZONE ?? parsed.API_FOOTBALL_TIMEZONE ?? "Etc/UTC",
  footballDataCacheTtlMs: Number(parsed.HIGHLIGHTLY_FOOTBALL_CACHE_TTL_MS ?? parsed.API_FOOTBALL_CACHE_TTL_MS ?? "180000"),
  footballDataFixtureLimit: Number(parsed.HIGHLIGHTLY_FOOTBALL_FIXTURE_LIMIT ?? parsed.API_FOOTBALL_FIXTURE_LIMIT ?? "18"),
  footballDataLookaheadDays: Number(parsed.HIGHLIGHTLY_FOOTBALL_LOOKAHEAD_DAYS ?? parsed.API_FOOTBALL_ODDS_LOOKAHEAD_DAYS ?? "5"),
  footballDataBookmakerId: parsed.HIGHLIGHTLY_FOOTBALL_BOOKMAKER_ID?.trim() ?? parsed.API_FOOTBALL_BOOKMAKER_ID?.trim(),
  footballDataOddsEnabled: (parsed.HIGHLIGHTLY_FOOTBALL_ODDS_ENABLED ?? "false") === "true",
  footballDataTimeoutMs: Number(parsed.HIGHLIGHTLY_FOOTBALL_TIMEOUT_MS ?? parsed.API_FOOTBALL_TIMEOUT_MS ?? "15000")
};

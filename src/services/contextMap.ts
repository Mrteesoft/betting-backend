import { LRUCache } from "lru-cache";
import { env } from "../config/env";
import { stateKeys, stateStore } from "./stateStore";

type ContextEntry = {
  sportId: string;
  action: string;
  marketId: string;
};

const cache = new LRUCache<string, string>({ max: 5000, ttl: env.contextCacheTtlMs });

const fieldKey = (sportId: string, action: string) => `${sportId}:${action}`;

export const getMarketForContext = async (sportId: string, action: string): Promise<string | null> => {
  const fk = fieldKey(sportId, action);
  const cached = cache.get(fk);
  if (cached) return cached;

  const market = await stateStore.hget(stateKeys.contextMap, fk);
  if (market) cache.set(fk, market);
  return market;
};

export const setContextEntry = async (entry: ContextEntry) => {
  cache.set(fieldKey(entry.sportId, entry.action), entry.marketId);
  await stateStore.hset(stateKeys.contextMap, fieldKey(entry.sportId, entry.action), entry.marketId);
};

export const reloadContextCache = async () => {
  cache.clear();
};

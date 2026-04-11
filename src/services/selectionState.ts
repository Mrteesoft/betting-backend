import { redis, redisKeys } from "./redis";
import { AvailableMarket, SelectionSnapshot } from "../types/otp";
import { getTimeBucket } from "./timeBucket";

const normaliseAvailableMarkets = (markets: Record<string, AvailableMarket> | undefined) => {
  if (!markets) {
    return undefined;
  }

  return Object.values(markets).reduce<Record<string, AvailableMarket>>((acc, market) => {
    acc[market.market_id] = market;
    return acc;
  }, {});
};

const normaliseSnapshot = (snapshot: SelectionSnapshot): SelectionSnapshot => ({
  ...snapshot,
  time_bucket: snapshot.time_bucket ?? getTimeBucket(snapshot.event_timestamp),
  available_markets: normaliseAvailableMarkets(snapshot.available_markets),
  special_selection: snapshot.special_selection ?? null
});

const collectSelectionIds = (snapshot: SelectionSnapshot) => {
  const ids = new Set<string>();
  ids.add(snapshot.selection_id);

  Object.values(snapshot.available_markets ?? {}).forEach((market) => ids.add(market.selection_id));

  if (snapshot.special_selection?.selection_id) {
    ids.add(snapshot.special_selection.selection_id);
  }

  return [...ids];
};

export const getSelectionsForMatches = async (
  userId: string,
  matchIds: string[]
): Promise<(SelectionSnapshot | null)[]> => {
  if (matchIds.length === 0) {
    return [];
  }

  const key = redisKeys.selections(userId);
  const results = await redis.hmget(key, ...matchIds);
  return results.map((val) => {
    if (!val) return null;
    try {
      return normaliseSnapshot(JSON.parse(val as string) as SelectionSnapshot);
    } catch {
      return null;
    }
  });
};

export const ingestSelections = async (userId: string, snapshots: SelectionSnapshot[]) => {
  if (snapshots.length === 0) {
    return 0;
  }

  const key = redisKeys.selections(userId);
  const indexKey = redisKeys.selectionIndex(userId);
  const selectionArgs: string[] = [];
  const indexArgs: string[] = [];

  snapshots.forEach((rawSnapshot) => {
    const snapshot = normaliseSnapshot(rawSnapshot);
    selectionArgs.push(snapshot.match_id, JSON.stringify(snapshot));

    collectSelectionIds(snapshot).forEach((selectionId) => {
      indexArgs.push(selectionId, snapshot.match_id);
    });
  });

  await Promise.all([
    redis.hset(key, ...selectionArgs),
    indexArgs.length > 0 ? redis.hset(indexKey, ...indexArgs) : Promise.resolve(0)
  ]);

  return snapshots.length;
};

export const getAllSelections = async (userId: string): Promise<Record<string, SelectionSnapshot>> => {
  const key = redisKeys.selections(userId);
  const raw = await redis.hgetall(key);
  const result: Record<string, SelectionSnapshot> = {};
  Object.entries(raw).forEach(([matchId, payload]) => {
    try {
      result[matchId] = normaliseSnapshot(JSON.parse(payload) as SelectionSnapshot);
    } catch {
      // ignore malformed
    }
  });
  return result;
};

export const updateMarkets = async (
  userId: string,
  updates: Array<{
    matchId: string;
    snapshot: SelectionSnapshot;
    selectionId: string;
    marketId: string;
    odds: number;
    updatedAt: string;
    specialSelection?: SelectionSnapshot["special_selection"];
  }>
) => {
  if (updates.length === 0) return;

  const key = redisKeys.selections(userId);
  const indexKey = redisKeys.selectionIndex(userId);
  const selectionArgs: string[] = [];
  const indexArgs: string[] = [];

  updates.forEach(({ matchId, snapshot, selectionId, marketId, odds, updatedAt, specialSelection }) => {
    const next = normaliseSnapshot({
      ...snapshot,
      selection_id: selectionId,
      market_id: marketId,
      odds,
      updated_at: updatedAt,
      special_selection: specialSelection ?? null
    });
    selectionArgs.push(matchId, JSON.stringify(next));
    indexArgs.push(selectionId, matchId);
  });

  await Promise.all([
    redis.hset(key, ...selectionArgs),
    indexArgs.length > 0 ? redis.hset(indexKey, ...indexArgs) : Promise.resolve(0)
  ]);
};

export const getLocks = async (userId: string, selectionIds: string[]) => {
  if (selectionIds.length === 0) {
    return [];
  }

  const key = redisKeys.locks(userId);

  try {
    const res = await redis.call("SMISMEMBER", key, ...selectionIds);
    if (Array.isArray(res)) {
      return res.map((value) => Number(value));
    }
  } catch {
    // fall through to pipelined SISMEMBER for local mocks/older Redis versions
  }

  const pipe = redis.pipeline();
  selectionIds.forEach((id) => pipe.sismember(key, id));
  const res = await pipe.exec();
  return (res ?? []).map(([err, val]) => (err ? 0 : Number(val))) as number[];
};

const findMatchIdBySelectionId = async (userId: string, selectionId: string): Promise<string | null> => {
  const indexed = await redis.hget(redisKeys.selectionIndex(userId), selectionId);
  if (indexed) {
    return indexed;
  }

  const key = redisKeys.selections(userId);
  let cursor = "0";
  do {
    // eslint-disable-next-line no-await-in-loop
    const [nextCursor, items] = await redis.hscan(key, cursor, "COUNT", 50);
    for (let i = 0; i < items.length; i += 2) {
      const matchId = items[i];
      const payload = items[i + 1];
      try {
        const snap = JSON.parse(payload) as SelectionSnapshot;
        if (snap.selection_id === selectionId) return matchId;
      } catch {
        // ignore
      }
    }
    cursor = nextCursor;
  } while (cursor !== "0");
  return null;
};

export const setLockState = async (userId: string, selectionId: string, locked: boolean) => {
  const lockKey = redisKeys.locks(userId);
  const actions = [];
  if (locked) {
    actions.push(redis.sadd(lockKey, selectionId));
  } else {
    actions.push(redis.srem(lockKey, selectionId));
  }

  const matchId = await findMatchIdBySelectionId(userId, selectionId);
  if (matchId) {
    const selKey = redisKeys.selections(userId);
    const payload = await redis.hget(selKey, matchId);
    if (payload) {
      try {
        const snap = JSON.parse(payload) as SelectionSnapshot;
        const next = normaliseSnapshot({ ...snap, isLocked: locked, updated_at: new Date().toISOString() });
        actions.push(redis.hset(selKey, matchId, JSON.stringify(next)));
      } catch {
        // ignore parse failure
      }
    }
  }
  await Promise.all(actions);
};

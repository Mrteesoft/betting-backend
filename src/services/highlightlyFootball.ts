import { env } from "../config/env";
import { isOneTapSpecialMarket, resolveOneTapSpecialSelection } from "./oneTapSpecial";
import { AvailableMarket, SelectionSnapshot } from "../types/otp";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

export type BoardFixture = {
  match_id: string;
  sport_id: string;
  league: string;
  home_team: string;
  away_team: string;
};

type HighlightlyEnvelope<T> = {
  data?: T[];
  pagination?: {
    totalCount?: number;
    offset?: number;
    limit?: number;
  };
  error?: string;
  message?: string;
  errors?: string[] | Record<string, string>;
};

type HighlightlyMatch = {
  id: number;
  date: string;
  round?: string;
  country?: {
    code?: string;
    name?: string;
  };
  league?: {
    id?: number;
    season?: number;
    name?: string;
  };
  homeTeam?: {
    id?: number;
    name?: string;
  };
  awayTeam?: {
    id?: number;
    name?: string;
  };
  state?: {
    description?: string;
    clock?: number | null;
    score?: {
      current?: string;
      penalties?: string;
    };
  };
};

type HighlightlyOddValue = {
  odd?: string | number;
  value?: string;
};

type HighlightlyOdd = {
  bookmakerId?: number;
  bookmakerName?: string;
  type?: string;
  market?: string;
  values?: HighlightlyOddValue[];
};

type HighlightlyOddsEntry = {
  matchId?: number;
  odds?: HighlightlyOdd[];
};

const CURRENT_MARKET_PRIORITY = [
  "BOTH_TEAMS_TO_SCORE_NO",
  "UNDER_4_5",
  "OVER_8_5_CORNERS",
  "CLEAN_SHEET_HOME",
  "MATCH_WINNER_HOME",
  "HOME_TOTAL_OVER_1_5",
  "AWAY_TOTAL_OVER_1_5"
] as const;
const PLACEHOLDER_MARKET_ID = "MATCH_INFO";
const FEATURED_FOOTBALL_LEAGUE_PATTERNS = [
  /premier league/i,
  /la liga/i,
  /serie a/i,
  /bundesliga/i,
  /ligue 1/i,
  /champions league/i,
  /europa league/i,
  /efl championship/i,
  /liga portugal/i,
  /eredivisie/i
] as const;

const LIVE_STATES = new Set([
  "first half",
  "second half",
  "half time",
  "extra time",
  "break time",
  "penalties",
  "in progress"
]);

const CLOSED_STATES = new Set([
  "finished",
  "finished after penalties",
  "finished after extra time",
  "postponed",
  "suspended",
  "cancelled",
  "awarded",
  "interrupted",
  "abandoned"
]);

const STATUS_SHORT_BY_STATE: Record<string, string> = {
  "not started": "NS",
  "first half": "1H",
  "second half": "2H",
  "half time": "HT",
  "extra time": "ET",
  "break time": "BT",
  penalties: "PEN",
  finished: "FT",
  "finished after penalties": "PEN",
  "finished after extra time": "AET",
  postponed: "PST",
  suspended: "SUSP",
  cancelled: "CANC",
  awarded: "AWD",
  interrupted: "INT",
  abandoned: "ABD",
  "in progress": "LIVE",
  unknown: "UNK",
  "to be announced": "TBA"
};

const cache = {
  value: null as { fixtures: BoardFixture[]; selections: SelectionSnapshot[] } | null,
  expiresAt: 0,
  inflight: null as Promise<{ fixtures: BoardFixture[]; selections: SelectionSnapshot[] }> | null
};
const staleCachePath = path.resolve(process.cwd(), ".cache", "highlightly-board.json");

const buildMatchId = (matchId: number) => `hl:${matchId}`;

const buildSelectionId = (matchId: number, marketId: string) => `hl:${matchId}:${marketId}`;

const normalise = (value: string | undefined) => value?.toLowerCase().replace(/\s+/g, " ").trim() ?? "";

const parseNumeric = (value: number | string | null | undefined) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const parseLineFromText = (value: string | undefined) => {
  if (!value) {
    return null;
  }

  const match = value.match(/(-?\d+(?:[.,]\d+)?)/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const parseCurrentScore = (rawScore: string | undefined) => {
  if (!rawScore) {
    return undefined;
  }

  const match = rawScore.match(/(\d+)\s*[-:]\s*(\d+)/);
  if (!match) {
    return undefined;
  }

  return {
    home: Number(match[1]),
    away: Number(match[2])
  };
};

const parseEventTimestamp = (date: string | undefined) => {
  if (!date) {
    return null;
  }

  const timestampMs = Date.parse(date);
  if (!Number.isFinite(timestampMs)) {
    return null;
  }

  return Math.floor(timestampMs / 1000);
};

const isClosedState = (stateDescription: string | undefined) => CLOSED_STATES.has(normalise(stateDescription));

const isLiveState = (stateDescription: string | undefined, clock: number | null | undefined) => {
  const description = normalise(stateDescription);

  if (LIVE_STATES.has(description)) {
    return true;
  }

  if (isClosedState(description) || description === "not started" || description === "to be announced") {
    return false;
  }

  return typeof clock === "number" && clock >= 0;
};

const buildStatusShort = (match: HighlightlyMatch) => {
  const description = normalise(match.state?.description);
  return STATUS_SHORT_BY_STATE[description] ?? undefined;
};

const buildStatusLabel = (match: HighlightlyMatch) => {
  const description = match.state?.description;
  const clock = match.state?.clock;

  if (isLiveState(description, clock) && typeof clock === "number") {
    return `${clock}'`;
  }

  return description ?? "Scheduled";
};

const extractErrors = (payload: HighlightlyEnvelope<unknown>) => {
  const errors: string[] = [];

  if (payload.error) {
    errors.push(payload.error);
  }

  if (payload.message) {
    errors.push(payload.message);
  }

  if (Array.isArray(payload.errors)) {
    errors.push(...payload.errors.filter(Boolean));
  } else if (payload.errors && typeof payload.errors === "object") {
    errors.push(...Object.values(payload.errors).filter(Boolean));
  }

  return errors;
};

const readStaleBoard = () => {
  if (!existsSync(staleCachePath)) {
    return null;
  }

  try {
    const payload = JSON.parse(readFileSync(staleCachePath, "utf8")) as {
      board?: { fixtures: BoardFixture[]; selections: SelectionSnapshot[] };
    };

    if (!payload.board) {
      return null;
    }

    return payload.board;
  } catch {
    return null;
  }
};

const writeStaleBoard = (board: { fixtures: BoardFixture[]; selections: SelectionSnapshot[] }) => {
  mkdirSync(path.dirname(staleCachePath), { recursive: true });
  writeFileSync(
    staleCachePath,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        board
      },
      null,
      2
    )
  );
};

const buildUrl = (path: string, params: Record<string, string | number | undefined>) => {
  const url = new URL(`${env.footballDataBaseUrl}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
};

const buildHeaders = (apiKey: string) => {
  const headers: Record<string, string> = {
    "x-rapidapi-key": apiKey
  };

  const host = new URL(env.footballDataBaseUrl).hostname;
  if (host.includes("rapidapi.com")) {
    headers["x-rapidapi-host"] = host;
  }

  return headers;
};

const fetchHighlightlyPage = async <T>(
  path: string,
  params: Record<string, string | number | undefined>
): Promise<HighlightlyEnvelope<T>> => {
  const apiKey = env.footballDataKey;
  if (!apiKey) {
    throw Object.assign(new Error("HIGHLIGHTLY_FOOTBALL_KEY is not configured."), { statusCode: 503 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.footballDataTimeoutMs);

  try {
    const response = await fetch(buildUrl(path, params), {
      method: "GET",
      headers: buildHeaders(apiKey),
      signal: controller.signal
    });

    const rawBody = await response.text();
    const payload = rawBody ? (JSON.parse(rawBody) as HighlightlyEnvelope<T>) : {};

    if (!response.ok) {
      const errors = extractErrors(payload);
      throw Object.assign(
        new Error(errors[0] ?? `Highlightly request failed with ${response.status}`),
        { statusCode: response.status }
      );
    }

    const errors = extractErrors(payload);
    if (errors.length > 0) {
      throw Object.assign(new Error(errors.join(", ")), { statusCode: 502 });
    }

    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw Object.assign(new Error("Highlightly request timed out."), { statusCode: 504 });
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const fetchAllPages = async <T>(
  path: string,
  params: Record<string, string | number | undefined>
): Promise<T[]> => {
  const items: T[] = [];
  let offset = 0;

  while (true) {
    const payload = await fetchHighlightlyPage<T>(path, { ...params, offset });
    const pageItems = payload.data ?? [];
    items.push(...pageItems);

    if (pageItems.length === 0) {
      break;
    }

    const responseOffset = payload.pagination?.offset ?? offset;
    const responseLimit = payload.pagination?.limit ?? pageItems.length;
    const totalCount = payload.pagination?.totalCount;
    const nextOffset = responseOffset + pageItems.length;

    if (typeof totalCount === "number" && nextOffset >= totalCount) {
      break;
    }

    if (pageItems.length < Math.max(responseLimit, 1)) {
      break;
    }

    offset = nextOffset;
  }

  return items;
};

const fetchSinglePage = async <T>(
  path: string,
  params: Record<string, string | number | undefined>
): Promise<T[]> => {
  const payload = await fetchHighlightlyPage<T>(path, params);
  return payload.data ?? [];
};

const parseDirection = (value: string | undefined) => {
  const label = normalise(value);

  if (label.startsWith("over")) {
    return "over";
  }

  if (label.startsWith("under")) {
    return "under";
  }

  return null;
};

const selectValue = (
  values: HighlightlyOddValue[] | undefined,
  predicate: (value: HighlightlyOddValue) => boolean
) => {
  if (!values || values.length === 0) {
    return null;
  }

  return values.find(predicate) ?? null;
};

const recordMarket = (
  matchId: number,
  markets: Record<string, AvailableMarket>,
  marketId: string,
  odds: number | null,
  line?: number
) => {
  if (markets[marketId] || odds === null) {
    return;
  }

  markets[marketId] = {
    selection_id: buildSelectionId(matchId, marketId),
    market_id: marketId,
    odds,
    ...(line !== undefined ? { line } : {})
  };
};

const getPreferredOdds = (oddsEntries: HighlightlyOdd[] | undefined) => {
  if (!oddsEntries || oddsEntries.length === 0) {
    return [];
  }

  const preferredBookmakerId = env.footballDataBookmakerId ? Number(env.footballDataBookmakerId) : null;

  return [...oddsEntries].sort((left, right) => {
    const leftPreferred = Number(left.bookmakerId === preferredBookmakerId);
    const rightPreferred = Number(right.bookmakerId === preferredBookmakerId);

    if (leftPreferred !== rightPreferred) {
      return rightPreferred - leftPreferred;
    }

    const leftLive = Number(normalise(left.type) === "live");
    const rightLive = Number(normalise(right.type) === "live");
    return rightLive - leftLive;
  });
};

const matchComplexMarketValue = (
  market: HighlightlyOdd,
  direction: "over" | "under",
  line: number
) => {
  const value = selectValue(market.values, (entry) => {
    if (parseDirection(entry.value) !== direction) {
      return false;
    }

    const parsedLine = parseLineFromText(entry.value) ?? parseLineFromText(market.market);
    return parsedLine !== null && Math.abs(parsedLine - line) < 0.01;
  });

  return parseNumeric(value?.odd);
};

export const extractAvailableMarketsFromOddsEntry = (
  matchId: number,
  entry: HighlightlyOddsEntry | null | undefined
) => {
  const markets: Record<string, AvailableMarket> = {};

  for (const market of getPreferredOdds(entry?.odds)) {
    const marketName = normalise(market.market);

    if (marketName === "full time result" || marketName === "match winner" || marketName === "1x2") {
      const homeValue = selectValue(market.values, (entryValue) => normalise(entryValue.value) === "home");
      recordMarket(matchId, markets, "MATCH_WINNER_HOME", parseNumeric(homeValue?.odd));
      continue;
    }

    if (marketName.includes("both teams to score")) {
      const noValue = selectValue(market.values, (entryValue) => normalise(entryValue.value) === "no");
      recordMarket(matchId, markets, "BOTH_TEAMS_TO_SCORE_NO", parseNumeric(noValue?.odd));
      continue;
    }

    if (marketName.includes("clean sheet")) {
      const homeValue = selectValue(market.values, (entryValue) => normalise(entryValue.value) === "home");
      recordMarket(matchId, markets, "CLEAN_SHEET_HOME", parseNumeric(homeValue?.odd));
      continue;
    }

    if (marketName.includes("total corners")) {
      recordMarket(matchId, markets, "OVER_8_5_CORNERS", matchComplexMarketValue(market, "over", 8.5), 8.5);
      continue;
    }

    if (
      marketName.includes("total goals") &&
      !marketName.includes("home") &&
      !marketName.includes("away") &&
      !marketName.includes("team 1") &&
      !marketName.includes("team 2")
    ) {
      recordMarket(matchId, markets, "UNDER_4_5", matchComplexMarketValue(market, "under", 4.5), 4.5);
      continue;
    }

    const isHomeTeamTotalMarket =
      (marketName.includes("home") || marketName.includes("team 1")) &&
      (marketName.includes("total") || marketName.includes("goals"));
    if (isHomeTeamTotalMarket) {
      recordMarket(matchId, markets, "HOME_TOTAL_OVER_1_5", matchComplexMarketValue(market, "over", 1.5), 1.5);
      continue;
    }

    const isAwayTeamTotalMarket =
      (marketName.includes("away") || marketName.includes("team 2")) &&
      (marketName.includes("total") || marketName.includes("goals"));
    if (isAwayTeamTotalMarket) {
      recordMarket(matchId, markets, "AWAY_TOTAL_OVER_1_5", matchComplexMarketValue(market, "over", 1.5), 1.5);
    }
  }

  return markets;
};

const chooseCurrentMarket = (markets: Record<string, AvailableMarket>) =>
  CURRENT_MARKET_PRIORITY.find((marketId) => markets[marketId]) ?? null;

const buildBoardFixture = (match: HighlightlyMatch): BoardFixture => ({
  match_id: buildMatchId(match.id),
  sport_id: "football",
  league: match.league?.name ?? "Football",
  home_team: match.homeTeam?.name ?? "Home",
  away_team: match.awayTeam?.name ?? "Away"
});

export const buildSelectionSnapshotFromMatch = (
  match: HighlightlyMatch,
  oddsEntry: HighlightlyOddsEntry | null | undefined
): SelectionSnapshot | null => {
  const eventTimestamp = parseEventTimestamp(match.date);
  if (eventTimestamp === null) {
    return null;
  }

  const markets = extractAvailableMarketsFromOddsEntry(match.id, oddsEntry);
  const currentMarketId = chooseCurrentMarket(markets);
  const currentMarket = currentMarketId ? markets[currentMarketId] : null;

  return {
    selection_id: currentMarket?.selection_id ?? buildSelectionId(match.id, PLACEHOLDER_MARKET_ID),
    match_id: buildMatchId(match.id),
    sport_id: "football",
    market_id: currentMarket?.market_id ?? PLACEHOLDER_MARKET_ID,
    event_timestamp: eventTimestamp,
    odds: currentMarket?.odds ?? 0,
    isLocked: isClosedState(match.state?.description),
    updated_at: new Date().toISOString(),
    available_markets: markets,
    score: parseCurrentScore(match.state?.score?.current),
    special_selection: null,
    status_short: buildStatusShort(match),
    status_label: buildStatusLabel(match),
    is_live: isLiveState(match.state?.description, match.state?.clock),
    provider: "highlightly"
  };
};

export const mergeSelectionSnapshot = (
  fresh: SelectionSnapshot,
  existing: SelectionSnapshot | undefined
): SelectionSnapshot => {
  if (!existing) {
    return fresh;
  }

  const mergedBase: SelectionSnapshot = {
    ...fresh,
    isLocked: existing.isLocked || fresh.isLocked
  };

  if (isOneTapSpecialMarket(existing.market_id)) {
    const specialSelection = resolveOneTapSpecialSelection(mergedBase, existing.market_id);
    if (specialSelection) {
      return {
        ...mergedBase,
        selection_id: specialSelection.selection_id,
        market_id: specialSelection.market_id,
        odds: specialSelection.combined_odds,
        special_selection: specialSelection
      };
    }
  }

  const currentMarket = mergedBase.available_markets?.[existing.market_id];
  if (!currentMarket) {
    return mergedBase;
  }

  return {
    ...mergedBase,
    selection_id: currentMarket.selection_id,
    market_id: currentMarket.market_id,
    odds: currentMarket.odds,
    special_selection: null
  };
};

const mergeOddsEntry = (current: HighlightlyOddsEntry | undefined, next: HighlightlyOddsEntry) => {
  if (!current) {
    return {
      ...next,
      odds: [...(next.odds ?? [])]
    };
  }

  return {
    ...current,
    odds: [...(current.odds ?? []), ...(next.odds ?? [])]
  };
};

const formatDateForTimezone = (date: Date, timezone: string) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Unable to format date for timezone ${timezone}`);
  }

  return `${year}-${month}-${day}`;
};

const buildDateSequence = (count: number) => {
  const safeCount = Math.max(count, 1);
  const today = formatDateForTimezone(new Date(), env.footballDataTimezone);
  const start = new Date(`${today}T00:00:00Z`);

  return Array.from({ length: safeCount }, (_, index) => {
    const current = new Date(start);
    current.setUTCDate(start.getUTCDate() + index);
    return current.toISOString().slice(0, 10);
  });
};

const isBoardEligibleMatch = (match: HighlightlyMatch) => {
  const timestamp = parseEventTimestamp(match.date);
  if (timestamp === null) {
    return false;
  }

  return !isClosedState(match.state?.description);
};

const getFeaturedLeaguePriority = (match: HighlightlyMatch) => {
  const leagueName = match.league?.name ?? "";
  const priorityIndex = FEATURED_FOOTBALL_LEAGUE_PATTERNS.findIndex((pattern) => pattern.test(leagueName));
  return priorityIndex === -1 ? Number.POSITIVE_INFINITY : priorityIndex;
};

export const orderBoardMatches = (matches: HighlightlyMatch[]) =>
  [...matches].sort((left, right) => {
    const leftPriority = getFeaturedLeaguePriority(left);
    const rightPriority = getFeaturedLeaguePriority(right);

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    const leftLive = isLiveState(left.state?.description, left.state?.clock);
    const rightLive = isLiveState(right.state?.description, right.state?.clock);
    if (leftLive !== rightLive) {
      return leftLive ? -1 : 1;
    }

    return (parseEventTimestamp(left.date) ?? 0) - (parseEventTimestamp(right.date) ?? 0);
  });

const fetchOddsForMatch = async (match: HighlightlyMatch) => {
  const requestParams = {
    matchId: match.id,
    ...(env.footballDataBookmakerId ? { bookmakerId: env.footballDataBookmakerId } : {})
  };

  const requests = [
    fetchHighlightlyPage<HighlightlyOddsEntry>("/odds", {
      ...requestParams,
      oddsType: "prematch"
    })
  ];

  if (isLiveState(match.state?.description, match.state?.clock)) {
    requests.unshift(
      fetchHighlightlyPage<HighlightlyOddsEntry>("/odds", {
        ...requestParams,
        oddsType: "live"
      })
    );
  }

  const results = await Promise.allSettled(requests);
  const entries = results
    .filter((result): result is PromiseFulfilledResult<HighlightlyEnvelope<HighlightlyOddsEntry>> => result.status === "fulfilled")
    .flatMap((result) => result.value.data ?? [])
    .filter((entry) => entry.matchId === match.id);

  if (entries.length === 0) {
    return null;
  }

  return entries.reduce<HighlightlyOddsEntry | undefined>((merged, entry) => mergeOddsEntry(merged, entry), undefined) ?? null;
};

const buildOddsMap = async (matches: HighlightlyMatch[]) => {
  if (!env.footballDataOddsEnabled || matches.length === 0) {
    return new Map<number, HighlightlyOddsEntry>();
  }

  const oddsEntries = await Promise.all(
    matches.map(async (match) => ({
      matchId: match.id,
      entry: await fetchOddsForMatch(match)
    }))
  );

  return new Map(
    oddsEntries
      .filter((item): item is { matchId: number; entry: HighlightlyOddsEntry } => item.entry !== null)
      .map((item) => [item.matchId, item.entry])
  );
};

const buildFreshBoardData = async () => {
  const dateWindow = buildDateSequence(env.footballDataLookaheadDays);
  const uniqueMatches = new Map<number, HighlightlyMatch>();
  const matchPageLimit = Math.max(env.footballDataFixtureLimit, 50);

  for (const date of dateWindow) {
    const pageItems = await fetchAllPages<HighlightlyMatch>("/matches", {
      date,
      timezone: env.footballDataTimezone,
      limit: matchPageLimit
    });

    pageItems.forEach((match) => {
      if (typeof match.id === "number" && isBoardEligibleMatch(match)) {
        uniqueMatches.set(match.id, match);
      }
    });
  }

  const orderedMatches = orderBoardMatches([...uniqueMatches.values()]).slice(0, env.footballDataFixtureLimit);

  const oddsByMatch = await buildOddsMap(orderedMatches);

  const selections = orderedMatches
    .map((match) => buildSelectionSnapshotFromMatch(match, oddsByMatch.get(match.id)))
    .filter((selection): selection is SelectionSnapshot => Boolean(selection));

  const fixtureMap = new Map(orderedMatches.map((match) => [buildMatchId(match.id), buildBoardFixture(match)]));

  return {
    fixtures: selections
      .map((selection) => fixtureMap.get(selection.match_id))
      .filter((fixture): fixture is BoardFixture => Boolean(fixture)),
    selections
  };
};

export const getHighlightlyBoardData = async () => {
  const now = Date.now();

  if (cache.value && cache.expiresAt > now) {
    return cache.value;
  }

  if (cache.inflight) {
    return cache.inflight;
  }

  cache.inflight = buildFreshBoardData()
    .then((value) => {
      cache.value = value;
      cache.expiresAt = Date.now() + env.footballDataCacheTtlMs;
      writeStaleBoard(value);
      return value;
    })
    .catch((error) => {
      const staleBoard = cache.value ?? readStaleBoard();
      if (staleBoard) {
        return staleBoard;
      }

      throw error;
    })
    .finally(() => {
      cache.inflight = null;
    });

  return cache.inflight;
};

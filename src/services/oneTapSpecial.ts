import { env } from "../config/env";
import {
  AvailableMarket,
  OneTapSpecialSelection,
  ScoreState,
  SelectionSnapshot
} from "../types/otp";

export const SUPPORTED_OTS_LINES = Object.freeze([0.5, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0]);

const OTS_MARKET_PREFIX = "OTS_BTIO_OVER_";
const HOME_MARKET_PREFIX = "HOME_TOTAL_OVER_";
const AWAY_MARKET_PREFIX = "AWAY_TOTAL_OVER_";

const toLineToken = (line: number) => line.toFixed(1).replace(".", "_");

const toLineValue = (lineToken: string) => Number(lineToken.replace("_", "."));

const isSupportedLine = (line: number) => SUPPORTED_OTS_LINES.includes(line);

const buildSyntheticSelectionId = (matchId: string, lineToken: string) => `ots:${matchId}:${lineToken}`;

const getLegMarket = (
  markets: Record<string, AvailableMarket> | undefined,
  marketId: string
): AvailableMarket | null => {
  if (!markets) {
    return null;
  }

  return markets[marketId] ?? null;
};

export const buildOneTapSpecialMarketId = (line: number) => `${OTS_MARKET_PREFIX}${toLineToken(line)}`;

export const buildOneTapSpecialLegMarketIds = (line: number) => {
  const token = toLineToken(line);

  return {
    homeMarketId: `${HOME_MARKET_PREFIX}${token}`,
    awayMarketId: `${AWAY_MARKET_PREFIX}${token}`,
    lineToken: token
  };
};

export const isOneTapSpecialMarket = (marketId: string) => marketId.startsWith(OTS_MARKET_PREFIX);

export const parseOneTapSpecialLine = (marketId: string): number | null => {
  if (!isOneTapSpecialMarket(marketId)) {
    return null;
  }

  const lineToken = marketId.slice(OTS_MARKET_PREFIX.length);
  const line = toLineValue(lineToken);
  if (!Number.isFinite(line) || !isSupportedLine(line)) {
    return null;
  }

  return line;
};

export const canUseOneTapSpecial = (apiKey: string) => {
  if (!env.otsExclusiveToAnchor) {
    return true;
  }

  if (!env.anchorPartnerApiKey) {
    return true;
  }

  return apiKey === env.anchorPartnerApiKey;
};

export const resolveOneTapSpecialSelection = (
  snapshot: SelectionSnapshot,
  targetMarket: string
): OneTapSpecialSelection | null => {
  if (snapshot.sport_id !== "football") {
    return null;
  }

  const line = parseOneTapSpecialLine(targetMarket);
  if (line === null) {
    return null;
  }

  const { homeMarketId, awayMarketId, lineToken } = buildOneTapSpecialLegMarketIds(line);
  const home = getLegMarket(snapshot.available_markets, homeMarketId);
  const away = getLegMarket(snapshot.available_markets, awayMarketId);

  if (!home || !away) {
    return null;
  }

  const combinedOdds = home.odds * away.odds;

  return {
    kind: "ONE_TAP_SPECIAL",
    line,
    market_id: targetMarket,
    selection_id: buildSyntheticSelectionId(snapshot.match_id, lineToken),
    combined_odds: combinedOdds,
    legs: [
      { market_id: home.market_id, selection_id: home.selection_id, odds: home.odds },
      { market_id: away.market_id, selection_id: away.selection_id, odds: away.odds }
    ]
  };
};

export const validateOneTapSpecialOutcome = (line: number, score: ScoreState) => {
  if (!isSupportedLine(line)) {
    throw Object.assign(new Error("Unsupported One Tap Special line"), { statusCode: 422 });
  }

  const goalThreshold = Math.floor(line) + 1;
  return score.home >= goalThreshold && score.away >= goalThreshold;
};

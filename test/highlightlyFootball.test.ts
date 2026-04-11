import { describe, expect, it } from "vitest";
import {
  buildSelectionSnapshotFromMatch,
  extractAvailableMarketsFromOddsEntry,
  mergeSelectionSnapshot,
  orderBoardMatches
} from "../src/services/highlightlyFootball";
import { buildOneTapSpecialMarketId } from "../src/services/oneTapSpecial";

describe("highlightly football mapping", () => {
  const match = {
    id: 9001,
    date: "2026-03-27T19:45:00.000Z",
    league: {
      name: "Premier League"
    },
    homeTeam: {
      name: "Arsenal"
    },
    awayTeam: {
      name: "Chelsea"
    },
    state: {
      description: "First half",
      clock: 52,
      score: {
        current: "1 - 0"
      }
    }
  };

  const oddsEntry = {
    matchId: 9001,
    odds: [
      {
        bookmakerId: 1,
        bookmakerName: "Testbook",
        type: "live",
        market: "Full Time Result",
        values: [
          { value: "Home", odd: 1.87 },
          { value: "Draw", odd: 3.1 },
          { value: "Away", odd: 4.4 }
        ]
      },
      {
        bookmakerId: 1,
        bookmakerName: "Testbook",
        type: "live",
        market: "Both Teams to Score",
        values: [
          { value: "Yes", odd: 1.72 },
          { value: "No", odd: 2.02 }
        ]
      },
      {
        bookmakerId: 1,
        bookmakerName: "Testbook",
        type: "live",
        market: "Total Goals 4.5",
        values: [
          { value: "Over", odd: 4.2 },
          { value: "Under", odd: 1.31 }
        ]
      },
      {
        bookmakerId: 1,
        bookmakerName: "Testbook",
        type: "live",
        market: "Total Corners 8.5",
        values: [
          { value: "Over", odd: 1.95 },
          { value: "Under", odd: 1.8 }
        ]
      },
      {
        bookmakerId: 1,
        bookmakerName: "Testbook",
        type: "prematch",
        market: "Home Team Total Goals 1.5",
        values: [
          { value: "Over", odd: 1.74 },
          { value: "Under", odd: 1.97 }
        ]
      },
      {
        bookmakerId: 1,
        bookmakerName: "Testbook",
        type: "prematch",
        market: "Away Team Total Goals 1.5",
        values: [
          { value: "Over", odd: 1.68 },
          { value: "Under", odd: 2.05 }
        ]
      }
    ]
  };

  it("extracts supported internal markets from highlightly odds", () => {
    const markets = extractAvailableMarketsFromOddsEntry(9001, oddsEntry);

    expect(markets.MATCH_WINNER_HOME?.odds).toBe(1.87);
    expect(markets.BOTH_TEAMS_TO_SCORE_NO?.odds).toBe(2.02);
    expect(markets.UNDER_4_5?.odds).toBe(1.31);
    expect(markets.OVER_8_5_CORNERS?.odds).toBe(1.95);
    expect(markets.HOME_TOTAL_OVER_1_5?.odds).toBe(1.74);
    expect(markets.AWAY_TOTAL_OVER_1_5?.odds).toBe(1.68);
  });

  it("builds a live selection snapshot from match and odds payloads", () => {
    const selection = buildSelectionSnapshotFromMatch(match, oddsEntry);

    expect(selection).not.toBeNull();
    expect(selection?.match_id).toBe("hl:9001");
    expect(selection?.market_id).toBe("BOTH_TEAMS_TO_SCORE_NO");
    expect(selection?.is_live).toBe(true);
    expect(selection?.status_label).toBe("52'");
    expect(selection?.score).toEqual({ home: 1, away: 0 });
    expect(selection?.provider).toBe("highlightly");
  });

  it("falls back to a fixture-only snapshot when odds are unavailable", () => {
    const selection = buildSelectionSnapshotFromMatch(match, null);

    expect(selection).not.toBeNull();
    expect(selection?.match_id).toBe("hl:9001");
    expect(selection?.market_id).toBe("MATCH_INFO");
    expect(selection?.odds).toBe(0);
    expect(selection?.available_markets).toEqual({});
    expect(selection?.status_label).toBe("52'");
  });

  it("preserves an existing one-tap special when the new snapshot still supports it", () => {
    const fresh = buildSelectionSnapshotFromMatch(match, oddsEntry);
    expect(fresh).not.toBeNull();

    const specialMarketId = buildOneTapSpecialMarketId(1.5);
    const merged = mergeSelectionSnapshot(fresh!, {
      ...fresh!,
      selection_id: "ots:hl:9001:1_5",
      market_id: specialMarketId,
      odds: 0,
      special_selection: null
    });

    expect(merged.market_id).toBe(specialMarketId);
    expect(merged.special_selection?.combined_odds).toBeCloseTo(1.74 * 1.68);
  });

  it("prioritizes featured leagues ahead of other football competitions on the board", () => {
    const orderedMatches = orderBoardMatches([
      {
        id: 2,
        date: "2026-04-03T19:45:00.000Z",
        league: { name: "Liga Mayor" },
        homeTeam: { name: "A" },
        awayTeam: { name: "B" },
        state: { description: "Not Started", clock: null }
      },
      {
        id: 3,
        date: "2026-04-03T18:00:00.000Z",
        league: { name: "Serie A" },
        homeTeam: { name: "Inter" },
        awayTeam: { name: "Milan" },
        state: { description: "Not Started", clock: null }
      },
      {
        id: 4,
        date: "2026-04-03T17:00:00.000Z",
        league: { name: "Premier League" },
        homeTeam: { name: "Arsenal" },
        awayTeam: { name: "Chelsea" },
        state: { description: "Not Started", clock: null }
      }
    ]);

    expect(orderedMatches.map((entry) => entry.league?.name)).toEqual([
      "Premier League",
      "Serie A",
      "Liga Mayor"
    ]);
  });
});

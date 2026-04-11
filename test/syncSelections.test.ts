import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("ioredis", async () => {
  const RedisMock = (await import("ioredis-mock")).default;
  return { __esModule: true, default: RedisMock };
});

import { setContextEntry } from "../src/services/contextMap";
import { getAllSelections, ingestSelections, setLockState } from "../src/services/selectionState";
import { syncSelections } from "../src/services/syncSelections";

describe("syncSelections", () => {
  beforeEach(async () => {
    // Clear context-map cache per test
    await setContextEntry({ sportId: "football", action: "SAFE_PLAY", marketId: "OVER_1_5" });
  });

  it("applies market to unlocked selections", async () => {
    const userId = "u1";
    const base = {
      sport_id: "football",
      market_id: "OLD",
      event_timestamp: Date.now(),
      odds: 1.2,
      isLocked: false,
      updated_at: new Date().toISOString(),
      available_markets: {
        OVER_1_5: { selection_id: "s1-over", market_id: "OVER_1_5", odds: 1.55 }
      }
    };
    await ingestSelections(userId, [
      { ...base, selection_id: "s1", match_id: "m1" },
      {
        ...base,
        selection_id: "s2",
        match_id: "m2",
        available_markets: {
          OVER_1_5: { selection_id: "s2-over", market_id: "OVER_1_5", odds: 1.61 }
        }
      }
    ]);

    const res = await syncSelections({
      userId,
      sportId: "football",
      action: "SAFE_PLAY",
      targetMarket: "OVER_1_5",
      matchIds: ["m1", "m2"],
      clientStateVersion: "v1",
      idempotencyKey: "k1",
      apiKey: "local-dev-key"
    });

    expect(res.applied).toBe(2);
    expect(res.skipped_locked).toBe(0);
    expect(res.updates).toHaveLength(2);
    expect(res.updates[0]).toMatchObject({
      match_id: "m1",
      selection_id: "s1-over",
      market_id: "OVER_1_5"
    });

    const selections = await getAllSelections(userId);
    expect(selections.m1.selection_id).toBe("s1-over");
    expect(selections.m1.market_id).toBe("OVER_1_5");
    expect(selections.m1.odds).toBe(1.55);
    expect(selections.m1.time_bucket).toBeDefined();
  });

  it("skips locked selections", async () => {
    const userId = "u2";
    const base = {
      sport_id: "football",
      market_id: "OLD",
      event_timestamp: Date.now(),
      odds: 1.2,
      isLocked: false,
      updated_at: new Date().toISOString(),
      available_markets: {
        OVER_1_5: { selection_id: "s3-over", market_id: "OVER_1_5", odds: 1.5 }
      }
    };
    await ingestSelections(userId, [
      { ...base, selection_id: "s3", match_id: "m3" },
      {
        ...base,
        selection_id: "s4",
        match_id: "m4",
        available_markets: {
          OVER_1_5: { selection_id: "s4-over", market_id: "OVER_1_5", odds: 1.52 }
        }
      }
    ]);
    await setLockState(userId, "s4", true);

    const res = await syncSelections({
      userId,
      sportId: "football",
      action: "SAFE_PLAY",
      targetMarket: "OVER_1_5",
      matchIds: ["m3", "m4"],
      clientStateVersion: "v1",
      idempotencyKey: "k2",
      apiKey: "local-dev-key"
    });

    expect(res.applied).toBe(1);
    expect(res.skipped_locked).toBe(1);
  });

  it("creates a One Tap Special selection for football when both legs exist", async () => {
    const userId = "u3";
    await setContextEntry({
      sportId: "football",
      action: "SOLOMON_SPECIAL",
      marketId: "OTS_BTIO_OVER_1_5"
    });

    await ingestSelections(userId, [
      {
        selection_id: "s5",
        match_id: "m5",
        sport_id: "football",
        market_id: "OLD",
        event_timestamp: Date.now(),
        odds: 1.4,
        isLocked: false,
        updated_at: new Date().toISOString(),
        available_markets: {
          HOME_TOTAL_OVER_1_5: {
            selection_id: "home-leg",
            market_id: "HOME_TOTAL_OVER_1_5",
            odds: 1.2
          },
          AWAY_TOTAL_OVER_1_5: {
            selection_id: "away-leg",
            market_id: "AWAY_TOTAL_OVER_1_5",
            odds: 1.4
          }
        }
      }
    ]);

    const res = await syncSelections({
      userId,
      sportId: "football",
      action: "SOLOMON_SPECIAL",
      targetMarket: "OTS_BTIO_OVER_1_5",
      matchIds: ["m5"],
      clientStateVersion: "v1",
      idempotencyKey: "k3",
      apiKey: "local-dev-key"
    });

    expect(res.applied).toBe(1);
    expect(res.updates[0].selection_id).toBe("ots:m5:1_5");
    expect(res.updates[0].combined_odds).toBeCloseTo(1.68);
    expect(res.updates[0].component_selection_ids).toEqual(["home-leg", "away-leg"]);

    const selections = await getAllSelections(userId);
    expect(selections.m5.special_selection?.market_id).toBe("OTS_BTIO_OVER_1_5");
    expect(selections.m5.special_selection?.combined_odds).toBeCloseTo(1.68);
    expect(selections.m5.selection_id).toBe("ots:m5:1_5");
  });
});

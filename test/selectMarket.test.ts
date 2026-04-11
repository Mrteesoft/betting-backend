import { describe, it, expect, vi } from "vitest";

vi.mock("ioredis", async () => {
  const RedisMock = (await import("ioredis-mock")).default;
  return { __esModule: true, default: RedisMock };
});

import { getAllSelections, ingestSelections, setLockState } from "../src/services/selectionState";
import { selectMarket } from "../src/services/selectMarket";

describe("selectMarket", () => {
  it("updates a single match to the chosen available market", async () => {
    const userId = "edit-user";
    await ingestSelections(userId, [
      {
        selection_id: "base-1",
        match_id: "match-1",
        sport_id: "football",
        market_id: "MATCH_INFO",
        event_timestamp: Date.now(),
        odds: 1.2,
        isLocked: false,
        updated_at: new Date().toISOString(),
        available_markets: {
          MATCH_WINNER_HOME: {
            selection_id: "home-1",
            market_id: "MATCH_WINNER_HOME",
            odds: 1.48
          },
          UNDER_4_5: {
            selection_id: "under-1",
            market_id: "UNDER_4_5",
            odds: 1.33
          }
        }
      }
    ]);

    const result = await selectMarket({
      userId,
      sportId: "football",
      matchId: "match-1",
      targetMarket: "UNDER_4_5",
      clientStateVersion: "v1",
      idempotencyKey: "select-market-k1",
      apiKey: "local-dev-key"
    });

    expect(result.applied).toBe(1);
    expect(result.updates[0]).toMatchObject({
      match_id: "match-1",
      selection_id: "under-1",
      market_id: "UNDER_4_5",
      odds: 1.33
    });

    const selections = await getAllSelections(userId);
    expect(selections["match-1"].selection_id).toBe("under-1");
    expect(selections["match-1"].market_id).toBe("UNDER_4_5");
    expect(selections["match-1"].odds).toBe(1.33);
  });

  it("returns skipped_locked when the match is locked", async () => {
    const userId = "locked-edit-user";
    await ingestSelections(userId, [
      {
        selection_id: "base-2",
        match_id: "match-2",
        sport_id: "football",
        market_id: "MATCH_INFO",
        event_timestamp: Date.now(),
        odds: 1.2,
        isLocked: false,
        updated_at: new Date().toISOString(),
        available_markets: {
          MATCH_WINNER_HOME: {
            selection_id: "home-2",
            market_id: "MATCH_WINNER_HOME",
            odds: 1.51
          }
        }
      }
    ]);
    await setLockState(userId, "base-2", true);

    const result = await selectMarket({
      userId,
      sportId: "football",
      matchId: "match-2",
      targetMarket: "MATCH_WINNER_HOME",
      clientStateVersion: "v1",
      idempotencyKey: "select-market-k2",
      apiKey: "local-dev-key"
    });

    expect(result.applied).toBe(0);
    expect(result.skipped_locked).toBe(1);
  });
});

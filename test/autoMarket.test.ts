import { describe, expect, it } from "vitest";
import { chooseAutoMarket } from "../src/services/autoMarket";
import { createPrototypeBoard } from "../src/services/prototypeBoard";

describe("Auto Market", () => {
  it("selects a preferred market inside server odds limits", () => {
    const result = chooseAutoMarket(createPrototypeBoard().selections[0], { minOdds: 1.5, maxOdds: 4, preferredMarkets: ["MATCH_WINNER_DRAW"] });
    expect(result?.market_id).toBe("MATCH_WINNER_DRAW");
  });
  it("returns null when no market passes safety constraints", () => {
    expect(chooseAutoMarket(createPrototypeBoard().selections[0], { minOdds: 10, maxOdds: 20 })).toBeNull();
  });
});

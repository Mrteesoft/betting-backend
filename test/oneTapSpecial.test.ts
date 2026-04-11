import { describe, expect, it } from "vitest";

import {
  buildOneTapSpecialLegMarketIds,
  buildOneTapSpecialMarketId,
  parseOneTapSpecialLine,
  validateOneTapSpecialOutcome
} from "../src/services/oneTapSpecial";

describe("oneTapSpecial", () => {
  it("builds consistent market ids for supported lines", () => {
    expect(buildOneTapSpecialMarketId(2.0)).toBe("OTS_BTIO_OVER_2_0");
    expect(buildOneTapSpecialLegMarketIds(2.0)).toEqual({
      homeMarketId: "HOME_TOTAL_OVER_2_0",
      awayMarketId: "AWAY_TOTAL_OVER_2_0",
      lineToken: "2_0"
    });
    expect(parseOneTapSpecialLine("OTS_BTIO_OVER_2_0")).toBe(2);
  });

  it("validates both teams clearing the selected line", () => {
    expect(validateOneTapSpecialOutcome(1.5, { home: 2, away: 2 })).toBe(true);
    expect(validateOneTapSpecialOutcome(1.5, { home: 2, away: 1 })).toBe(false);
    expect(validateOneTapSpecialOutcome(3.0, { home: 4, away: 4 })).toBe(true);
    expect(validateOneTapSpecialOutcome(3.0, { home: 3, away: 4 })).toBe(false);
  });
});

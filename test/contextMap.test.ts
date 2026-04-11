import { describe, it, expect } from "vitest";

import { setContextEntry, getMarketForContext, reloadContextCache } from "../src/services/contextMap";

describe("contextMap", () => {
  it("stores and retrieves entries with cache", async () => {
    await setContextEntry({ sportId: "basketball", action: "FAST_PLAY", marketId: "OVER_200" });
    const first = await getMarketForContext("basketball", "FAST_PLAY");
    expect(first).toBe("OVER_200");
    await reloadContextCache();
    const second = await getMarketForContext("basketball", "FAST_PLAY");
    expect(second).toBe("OVER_200");
  });
});

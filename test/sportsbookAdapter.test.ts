import { describe, expect, it } from "vitest";
import { getSportsbookAdapter } from "../src/services/sportsbookAdapters";

describe("sportsbook adapter", () => {
  it("validates and accepts a normalized bet", async () => {
    const adapter = getSportsbookAdapter("qaxiom-prototype");
    const legs = [{ eventId: "e1", selectionId: "s1", marketId: "HOME", odds: 1.8 }];
    expect((await adapter.validateSelections(legs)).valid).toBe(true);
    const receipt = await adapter.placeBet({ externalUserId: "u1", stake: 1000, currency: "NGN", legs, idempotencyKey: "adapter-test" });
    expect(receipt.status).toBe("ACCEPTED");
    expect(receipt.potentialReturn).toBe(1800);
  });
});

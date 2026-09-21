import { priceBet } from "./betPricing";
import { randomUUID } from "crypto";
import { BetReceipt, BetRequest, SportsbookAdapter } from "../types/sportsbook";

class PrototypeSportsbookAdapter implements SportsbookAdapter {
  readonly id = "qaxiom-prototype";

  async validateSelections(legs: BetRequest["legs"]) {
    if (legs.length < 1 || legs.length > 40) return { valid: false, reason: "Bet must contain 1 to 40 legs" };
    if (new Set(legs.map((leg) => leg.eventId)).size !== legs.length) return { valid: false, reason: "Only one selection per event is allowed" };
    if (legs.some((leg) => !Number.isFinite(leg.odds) || leg.odds < 1.01 || leg.odds > 1000)) return { valid: false, reason: "Invalid odds" };
    return { valid: true };
  }

  async placeBet(request: BetRequest): Promise<BetReceipt> {
    const acceptedOdds = Number(priceBet(request.legs.map(leg => leg.odds), request.betType).toFixed(4));
    return {
      id: `bet_${randomUUID()}`,
      sportsbook: this.id,
      userId: request.externalUserId,
      betType: request.betType ?? "multiple",
      status: "ACCEPTED",
      stake: request.stake,
      currency: request.currency,
      acceptedOdds,
      potentialReturn: Number((request.stake * acceptedOdds).toFixed(2)),
      legs: request.legs,
      createdAt: new Date().toISOString()
    };
  }
}

const adapters = new Map<string, SportsbookAdapter>();
export const registerSportsbookAdapter = (adapter: SportsbookAdapter) => adapters.set(adapter.id, adapter);
export const getSportsbookAdapter = (id: string) => {
  const adapter = adapters.get(id);
  if (!adapter) throw Object.assign(new Error(`Unknown sportsbook adapter: ${id}`), { statusCode: 404 });
  return adapter;
};
registerSportsbookAdapter(new PrototypeSportsbookAdapter());

import { canUseOneTapSpecial, isOneTapSpecialMarket, resolveOneTapSpecialSelection } from "./oneTapSpecial";
import { getLocks, getSelectionsForMatches, updateMarkets } from "./selectionState";
import { withIdempotency } from "./idempotency";
import { AvailableMarket, SelectMarketResponse, SelectionSnapshot } from "../types/otp";

type SelectMarketInput = {
  userId: string;
  sportId: string;
  matchId: string;
  targetMarket: string;
  clientStateVersion: string;
  idempotencyKey: string;
  apiKey: string;
};

const resolveStandardMarket = (snapshot: SelectionSnapshot, targetMarket: string): AvailableMarket | null => {
  if (snapshot.available_markets?.[targetMarket]) {
    return snapshot.available_markets[targetMarket];
  }

  if (snapshot.market_id === targetMarket) {
    return {
      selection_id: snapshot.selection_id,
      market_id: snapshot.market_id,
      odds: snapshot.odds
    };
  }

  return null;
};

export const selectMarket = async (input: SelectMarketInput): Promise<SelectMarketResponse> =>
  withIdempotency(input.userId, input.idempotencyKey, async () => {
    if (!input.userId) {
      throw Object.assign(new Error("user_id required"), { statusCode: 400 });
    }

    if (!input.matchId) {
      throw Object.assign(new Error("match_id required"), { statusCode: 400 });
    }

    if (isOneTapSpecialMarket(input.targetMarket) && !canUseOneTapSpecial(input.apiKey)) {
      throw Object.assign(new Error("One Tap Special is restricted to the anchor partner"), {
        statusCode: 403
      });
    }

    const [snapshot] = await getSelectionsForMatches(input.userId, [input.matchId]);
    if (!snapshot) {
      throw Object.assign(new Error("Selection not found"), { statusCode: 404 });
    }

    if (snapshot.sport_id !== input.sportId) {
      throw Object.assign(new Error("sport_id mismatch"), { statusCode: 422 });
    }

    const [locked] = await getLocks(input.userId, [snapshot.selection_id]);
    if (snapshot.isLocked || locked === 1) {
      return {
        ok: true,
        applied: 0,
        skipped_locked: 1,
        skipped_missing: 0,
        updates: [],
        server_state_version: `v${Date.now()}`
      };
    }

    const timestamp = new Date().toISOString();

    if (isOneTapSpecialMarket(input.targetMarket)) {
      const specialSelection = resolveOneTapSpecialSelection(snapshot, input.targetMarket);
      if (!specialSelection) {
        return {
          ok: true,
          applied: 0,
          skipped_locked: 0,
          skipped_missing: 1,
          updates: [],
          server_state_version: `v${Date.now()}`
        };
      }

      await updateMarkets(input.userId, [
        {
          matchId: input.matchId,
          snapshot,
          selectionId: specialSelection.selection_id,
          marketId: specialSelection.market_id,
          odds: specialSelection.combined_odds,
          updatedAt: timestamp,
          specialSelection
        }
      ]);

      return {
        ok: true,
        applied: 1,
        skipped_locked: 0,
        skipped_missing: 0,
        updates: [
          {
            match_id: input.matchId,
            selection_id: specialSelection.selection_id,
            market_id: specialSelection.market_id,
            odds: specialSelection.combined_odds,
            combined_odds: specialSelection.combined_odds,
            component_selection_ids: specialSelection.legs.map((leg) => leg.selection_id)
          }
        ],
        server_state_version: `v${Date.now()}`
      };
    }

    const market = resolveStandardMarket(snapshot, input.targetMarket);
    if (!market) {
      return {
        ok: true,
        applied: 0,
        skipped_locked: 0,
        skipped_missing: 1,
        updates: [],
        server_state_version: `v${Date.now()}`
      };
    }

    await updateMarkets(input.userId, [
      {
        matchId: input.matchId,
        snapshot,
        selectionId: market.selection_id,
        marketId: market.market_id,
        odds: market.odds,
        updatedAt: timestamp,
        specialSelection: null
      }
    ]);

    return {
      ok: true,
      applied: 1,
      skipped_locked: 0,
      skipped_missing: 0,
      updates: [
        {
          match_id: input.matchId,
          selection_id: market.selection_id,
          market_id: market.market_id,
          odds: market.odds
        }
      ],
      server_state_version: `v${Date.now()}`
    };
  });

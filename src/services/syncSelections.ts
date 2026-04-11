import { canUseOneTapSpecial, isOneTapSpecialMarket, resolveOneTapSpecialSelection } from "./oneTapSpecial";
import { getMarketForContext } from "./contextMap";
import { getLocks, getSelectionsForMatches, updateMarkets } from "./selectionState";
import { withIdempotency } from "./idempotency";
import { AvailableMarket, SelectionSnapshot, SyncSelectionsResponse } from "../types/otp";

type SyncInput = {
  userId: string;
  sportId: string;
  action: string;
  targetMarket: string;
  matchIds: string[];
  clientStateVersion: string;
  idempotencyKey: string;
  apiKey: string;
};

const unique = <T>(values: T[]) => [...new Set(values)];

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

export const syncSelections = async (input: SyncInput): Promise<SyncSelectionsResponse> =>
  withIdempotency(input.userId, input.idempotencyKey, async () => {
    if (!input.userId) {
      throw Object.assign(new Error("user_id required"), { statusCode: 400 });
    }
    if (!Array.isArray(input.matchIds) || input.matchIds.length === 0) {
      throw Object.assign(new Error("match_ids required"), { statusCode: 400 });
    }
    if (input.matchIds.length > 500) {
      throw Object.assign(new Error("Too many match_ids"), { statusCode: 413 });
    }

    const matchIds = unique(input.matchIds);

    if (isOneTapSpecialMarket(input.targetMarket) && !canUseOneTapSpecial(input.apiKey)) {
      throw Object.assign(new Error("One Tap Special is restricted to the anchor partner"), {
        statusCode: 403
      });
    }

    const [expectedMarket, selections] = await Promise.all([
      getMarketForContext(input.sportId, input.action),
      getSelectionsForMatches(input.userId, matchIds)
    ]);
    if (!expectedMarket) {
      throw Object.assign(new Error("Unsupported sport/action"), { statusCode: 422 });
    }
    if (expectedMarket !== input.targetMarket) {
      throw Object.assign(new Error("target_market mismatch"), { statusCode: 422 });
    }

    const selectionIds = selections
      .map((s) => s?.selection_id)
      .filter((v): v is string => Boolean(v));
    const locks = selectionIds.length > 0 ? await getLocks(input.userId, selectionIds) : [];
    const lockMap = new Map<string, number>();
    selectionIds.forEach((id, idx) => lockMap.set(id, locks[idx]));

    let applied = 0;
    let skippedLocked = 0;
    let skippedMissing = 0;
    const updates: Array<{
      matchId: string;
      snapshot: SelectionSnapshot;
      selectionId: string;
      marketId: string;
      odds: number;
      updatedAt: string;
      specialSelection?: SelectionSnapshot["special_selection"];
    }> = [];
    const updatesForResponse: SyncSelectionsResponse["updates"] = [];
    const timestamp = new Date().toISOString();

    selections.forEach((snap, idx) => {
      const matchId = matchIds[idx];
      if (!snap) {
        skippedMissing += 1;
        return;
      }
      if (snap.sport_id !== input.sportId) {
        skippedMissing += 1;
        return;
      }
      const locked = snap.isLocked || lockMap.get(snap.selection_id) === 1;
      if (locked) {
        skippedLocked += 1;
        return;
      }

      if (isOneTapSpecialMarket(input.targetMarket)) {
        const specialSelection = resolveOneTapSpecialSelection(snap, input.targetMarket);
        if (!specialSelection) {
          skippedMissing += 1;
          return;
        }

        updates.push({
          matchId,
          snapshot: snap,
          selectionId: specialSelection.selection_id,
          marketId: specialSelection.market_id,
          odds: specialSelection.combined_odds,
          updatedAt: timestamp,
          specialSelection
        });
        updatesForResponse.push({
          match_id: matchId,
          selection_id: specialSelection.selection_id,
          market_id: specialSelection.market_id,
          odds: specialSelection.combined_odds,
          combined_odds: specialSelection.combined_odds,
          component_selection_ids: specialSelection.legs.map((leg) => leg.selection_id)
        });
        applied += 1;
        return;
      }

      const market = resolveStandardMarket(snap, input.targetMarket);
      if (!market) {
        skippedMissing += 1;
        return;
      }

      updates.push({
        matchId,
        snapshot: snap,
        selectionId: market.selection_id,
        marketId: market.market_id,
        odds: market.odds,
        updatedAt: timestamp,
        specialSelection: null
      });
      updatesForResponse.push({
        match_id: matchId,
        selection_id: market.selection_id,
        market_id: market.market_id,
        odds: market.odds
      });
      applied += 1;
    });

    await updateMarkets(input.userId, updates);

    const response: SyncSelectionsResponse = {
      ok: true,
      applied,
      skipped_locked: skippedLocked,
      skipped_missing: skippedMissing,
      updates: updatesForResponse,
      server_state_version: `v${Date.now()}`
    };
    return response;
  });

import { getAllSelections, ingestSelections } from "./selectionState";
import { publishOddsUpdate } from "./realtime";
import {
  isOneTapSpecialMarket,
  resolveOneTapSpecialSelection,
} from "./oneTapSpecial";
import { createPrototypeBoard } from "./prototypeBoard";

const users = new Map<string, number>();
let tick = 0;
export const registerMockUser = (userId: string) =>
  users.set(userId, Date.now());
export const advanceMockOdds = async () => {
  const base = new Map(
    createPrototypeBoard().selections.map((s) => [s.match_id, s]),
  );
  tick++;
  for (const [userId, lastSeen] of users) {
    if (Date.now() - lastSeen > 3600000) {
      users.delete(userId);
      continue;
    }
    const selections = Object.values(await getAllSelections(userId));
    for (const [index, selection] of selections.entries()) {
      const seed = base.get(selection.match_id);
      if (
        !seed ||
        selection.isLocked ||
        selection.provider !== "qaxiom-prototype"
      )
        continue;
      for (const market of Object.values(selection.available_markets ?? {})) {
        const price = seed.available_markets?.[market.market_id]?.odds;
        if (price)
          market.odds = Math.max(
            1.01,
            Number(
              (price * (1 + 0.06 * Math.sin((tick + index) / 3))).toFixed(2),
            ),
          );
      }
      const market = selection.available_markets?.[selection.market_id];
      if (market) selection.odds = market.odds;
      if (isOneTapSpecialMarket(selection.market_id)) {
        const special = resolveOneTapSpecialSelection(
          selection,
          selection.market_id,
        );
        if (special) {
          selection.special_selection = special;
          selection.odds = special.combined_odds;
        }
      }
      selection.updated_at = new Date().toISOString();
      await ingestSelections(userId, [selection]);
      publishOddsUpdate({
        user_id: userId,
        match_id: selection.match_id,
        selection_id: selection.selection_id,
        odds: selection.odds,
        suspended: false,
        snapshot: selection,
      });
    }
  }
};

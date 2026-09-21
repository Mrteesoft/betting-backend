import { SelectionSnapshot } from "../types/otp";

export type AutoMarketPolicy = { minOdds: number; maxOdds: number; preferredMarkets?: string[] };
export const chooseAutoMarket = (snapshot: SelectionSnapshot, policy: AutoMarketPolicy) => {
  const markets = Object.values(snapshot.available_markets ?? {}).filter(
    (market) => market.odds >= policy.minOdds && market.odds <= policy.maxOdds
  );
  const preferred = policy.preferredMarkets ?? [];
  markets.sort((a, b) => {
    const ar = preferred.indexOf(a.market_id);
    const br = preferred.indexOf(b.market_id);
    if (ar !== br) return (ar < 0 ? 999 : ar) - (br < 0 ? 999 : br);
    return a.odds - b.odds;
  });
  return markets[0] ?? null;
};

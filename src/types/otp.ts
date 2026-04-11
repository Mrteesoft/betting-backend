export type TimeBucket = "TODAY" | "WEEKLY" | "MONTHLY";

export type AvailableMarket = {
  selection_id: string;
  market_id: string;
  odds: number;
  line?: number;
};

export type ScoreState = {
  home: number;
  away: number;
};

export type OneTapSpecialLeg = {
  market_id: string;
  selection_id: string;
  odds: number;
};

export type OneTapSpecialSelection = {
  kind: "ONE_TAP_SPECIAL";
  line: number;
  market_id: string;
  selection_id: string;
  combined_odds: number;
  legs: [OneTapSpecialLeg, OneTapSpecialLeg];
};

export type SelectionSnapshot = {
  selection_id: string;
  match_id: string;
  sport_id: string;
  market_id: string;
  event_timestamp: number;
  odds: number;
  isLocked: boolean;
  updated_at: string;
  time_bucket?: TimeBucket;
  available_markets?: Record<string, AvailableMarket>;
  score?: ScoreState;
  special_selection?: OneTapSpecialSelection | null;
  status_short?: string;
  status_label?: string;
  is_live?: boolean;
  provider?: string;
};

export type SyncSelectionsResponse = {
  ok: true;
  applied: number;
  skipped_locked: number;
  skipped_missing: number;
  updates: Array<{
    match_id: string;
    selection_id: string;
    market_id: string;
    odds: number;
    combined_odds?: number;
    component_selection_ids?: string[];
  }>;
  server_state_version: string;
};

export type SelectMarketResponse = SyncSelectionsResponse;

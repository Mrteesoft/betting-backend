import { SelectionSnapshot, AvailableMarket, TimeBucket } from "../types/otp";
import { BoardFixture } from "./highlightlyFootball";
const DAY_MS = 86400000;
type DummyMatchInput = BoardFixture & {
  offsetDays: number;
  hour: number;
  minute?: number;
  isLocked?: boolean;
  isLive?: boolean;
  statusLabel?: string;
  score?: SelectionSnapshot["score"];
  marketId: string;
  markets: Record<string, number>;
};

export const prototypeSportActions = {
  football: [
    {
      action: "SOLOMON_SPECIAL",
      target_market: "OTS_BTIO_OVER_1_5",
      label: "Home & Away Over 1.5",
      description: "Apply the combined home and away team over line to every open football match.",
      prominence: "featured"
    },
    {
      action: "SAFE_PLAY",
      target_market: "MATCH_WINNER_HOME",
      label: "Home Win",
      description: "Move the selected matches to the home win price.",
      prominence: "secondary"
    }
  ],
  basketball: [
    {
      action: "SPREAD_PLAY",
      target_market: "SPREAD_HOME_MINUS_4_5",
      label: "Home -4.5",
      description: "Move the selected games to the home spread.",
      prominence: "featured"
    },
    {
      action: "TOTAL_PLAY",
      target_market: "TOTAL_OVER_200",
      label: "Over 200",
      description: "Move the selected games to the total over price.",
      prominence: "secondary"
    }
  ],
  tennis: [
    {
      action: "WINNER_PLAY",
      target_market: "MATCH_WINNER_2WAY",
      label: "Winner",
      description: "Move the selected matches to the match winner price.",
      prominence: "featured"
    },
    {
      action: "GAMES_PLAY",
      target_market: "TOTAL_GAMES_OVER_20_5",
      label: "Over 20.5",
      description: "Move the selected matches to the games total over price.",
      prominence: "secondary"
    }
  ]
};

const getKickoff = (offsetDays: number, hour: number, minute = 0) => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return startOfToday + offsetDays * DAY_MS + hour * 60 * 60 * 1000 + minute * 60 * 1000;
};

const getTimeBucket = (offsetDays: number): TimeBucket => {
  if (offsetDays === 0) {
    return "TODAY";
  }

  return offsetDays <= 7 ? "WEEKLY" : "MONTHLY";
};

const market = (matchId: string, marketId: string, odds: number): AvailableMarket => {
  const lineMatch = marketId.match(/(?:OVER|UNDER|PLUS|MINUS)_(-?\d+)_?(\d+)?$/);
  const line =
    lineMatch && lineMatch[2] !== undefined
      ? Number(`${lineMatch[1]}.${lineMatch[2]}`)
      : undefined;

  return {
    selection_id: `dummy:${matchId}:${marketId}`,
    market_id: marketId,
    odds,
    ...(line !== undefined && Number.isFinite(line) ? { line } : {})
  };
};

const buildMarkets = (matchId: string, prices: Record<string, number>) =>
  Object.fromEntries(
    Object.entries(prices).map(([marketId, odds]) => [marketId, market(matchId, marketId, odds)])
  );

const createSelection = (input: DummyMatchInput): SelectionSnapshot => {
  const availableMarkets = buildMarkets(input.match_id, input.markets);
  const selectedMarket = availableMarkets[input.marketId] ?? Object.values(availableMarkets)[0];

  return {
    selection_id: selectedMarket.selection_id,
    match_id: input.match_id,
    sport_id: input.sport_id,
    market_id: selectedMarket.market_id,
    event_timestamp: getKickoff(input.offsetDays, input.hour, input.minute),
    odds: selectedMarket.odds,
    isLocked: Boolean(input.isLocked),
    updated_at: new Date().toISOString(),
    time_bucket: getTimeBucket(input.offsetDays),
    available_markets: availableMarkets,
    score: input.score,
    special_selection: null,
    status_short: input.isLocked ? "LOCKED" : input.isLive ? "LIVE" : "NS",
    status_label: input.statusLabel ?? (input.isLocked ? "Locked" : input.isLive ? "Live" : "Upcoming"),
    is_live: Boolean(input.isLive),
    provider: "qaxiom-prototype"
  };
};

const footballMarkets = (seed: number) => ({
  MATCH_WINNER_HOME: [1.74, 1.91, 1.62, 2.05, 1.84, 1.69, 1.58, 2.14][seed % 8],
  MATCH_WINNER_DRAW: [3.42, 3.18, 3.72, 3.08, 3.36, 3.58, 3.9, 3.2][seed % 8],
  MATCH_WINNER_AWAY: [4.35, 3.86, 5.2, 3.34, 4.1, 4.7, 5.6, 3.05][seed % 8],
  BOTH_TEAMS_TO_SCORE_YES: [1.82, 1.74, 1.9, 1.68, 1.78, 1.86, 1.95, 1.7][seed % 8],
  BOTH_TEAMS_TO_SCORE_NO: [1.92, 2.02, 1.86, 2.12, 1.98, 1.9, 1.82, 2.08][seed % 8],
  OVER_4_5: [3.05, 2.82, 3.34, 2.76, 3.18, 3.42, 2.95, 2.88][seed % 8],
  UNDER_4_5: [1.34, 1.41, 1.29, 1.44, 1.35, 1.31, 1.38, 1.4][seed % 8],
  OVER_8_5_CORNERS: [1.86, 1.78, 1.92, 1.84, 1.76, 1.88, 1.81, 1.94][seed % 8],
  UNDER_8_5_CORNERS: [1.82, 1.9, 1.76, 1.84, 1.94, 1.8, 1.86, 1.74][seed % 8],
  CLEAN_SHEET_HOME: [2.32, 2.48, 2.18, 2.72, 2.42, 2.24, 2.08, 2.64][seed % 8],
  CLEAN_SHEET_AWAY: [3.1, 2.94, 3.44, 2.5, 3.02, 3.26, 3.68, 2.36][seed % 8],
  HOME_TOTAL_OVER_1_5: [1.96, 2.12, 1.78, 2.22, 2.04, 1.84, 1.72, 2.3][seed % 8],
  HOME_TOTAL_UNDER_1_5: [1.76, 1.66, 1.92, 1.58, 1.72, 1.86, 1.98, 1.54][seed % 8],
  AWAY_TOTAL_OVER_1_5: [2.58, 2.36, 3.05, 2.04, 2.46, 2.74, 3.22, 1.96][seed % 8],
  AWAY_TOTAL_UNDER_1_5: [1.46, 1.52, 1.34, 1.7, 1.5, 1.42, 1.3, 1.76][seed % 8]
});

const basketballMarkets = (seed: number) => ({
  MATCH_WINNER_2WAY: [1.58, 1.74, 1.66][seed % 3],
  TOTAL_OVER_200: [1.86, 1.9, 1.82][seed % 3],
  TOTAL_UNDER_200: [1.86, 1.82, 1.9][seed % 3],
  SPREAD_HOME_MINUS_4_5: [1.91, 1.88, 1.94][seed % 3],
  SPREAD_AWAY_PLUS_4_5: [1.87, 1.9, 1.84][seed % 3],
  TEAM_TOTAL_HOME_OVER_101_5: [1.84, 1.78, 1.88][seed % 3],
  TEAM_TOTAL_HOME_UNDER_101_5: [1.88, 1.94, 1.84][seed % 3]
});

const tennisMarkets = (seed: number) => ({
  MATCH_WINNER_2WAY: [1.72, 1.54, 1.86][seed % 3],
  TOTAL_GAMES_OVER_20_5: [1.84, 1.9, 1.78][seed % 3],
  TOTAL_GAMES_UNDER_20_5: [1.88, 1.82, 1.96][seed % 3]
});

const dummyMatches: DummyMatchInput[] = [
  {
    match_id: "match-ars-che",
    sport_id: "football",
    league: "Premier League",
    home_team: "Arsenal",
    away_team: "Chelsea",
    offsetDays: 0,
    hour: 20,
    marketId: "MATCH_WINNER_HOME",
    markets: footballMarkets(0)
  },
  {
    match_id: "match-liv-tot",
    sport_id: "football",
    league: "Premier League",
    home_team: "Liverpool",
    away_team: "Tottenham",
    offsetDays: 0,
    hour: 17,
    minute: 30,
    isLive: true,
    score: { home: 1, away: 0 },
    marketId: "BOTH_TEAMS_TO_SCORE_YES",
    markets: footballMarkets(1)
  },
  {
    match_id: "match-avl-whu",
    sport_id: "football",
    league: "Premier League",
    home_team: "Aston Villa",
    away_team: "West Ham",
    offsetDays: 0,
    hour: 13,
    marketId: "MATCH_WINNER_HOME",
    markets: footballMarkets(2)
  },
  {
    match_id: "match-bha-ful",
    sport_id: "football",
    league: "Premier League",
    home_team: "Brighton",
    away_team: "Fulham",
    offsetDays: 0,
    hour: 14,
    minute: 30,
    marketId: "BOTH_TEAMS_TO_SCORE_NO",
    markets: footballMarkets(3)
  },
  {
    match_id: "match-bre-eve",
    sport_id: "football",
    league: "Premier League",
    home_team: "Brentford",
    away_team: "Everton",
    offsetDays: 0,
    hour: 16,
    marketId: "UNDER_4_5",
    markets: footballMarkets(4)
  },
  {
    match_id: "match-cry-wol",
    sport_id: "football",
    league: "Premier League",
    home_team: "Crystal Palace",
    away_team: "Wolves",
    offsetDays: 0,
    hour: 18,
    minute: 45,
    marketId: "HOME_TOTAL_OVER_1_5",
    markets: footballMarkets(5)
  },
  {
    match_id: "match-lei-not",
    sport_id: "football",
    league: "Premier League",
    home_team: "Leicester",
    away_team: "Nottingham Forest",
    offsetDays: 0,
    hour: 21,
    marketId: "MATCH_WINNER_AWAY",
    markets: footballMarkets(6)
  },
  {
    match_id: "match-mci-new",
    sport_id: "football",
    league: "Premier League",
    home_team: "Man City",
    away_team: "Newcastle",
    offsetDays: 1,
    hour: 19,
    marketId: "UNDER_4_5",
    markets: footballMarkets(2)
  },
  {
    match_id: "match-rma-sev",
    sport_id: "football",
    league: "La Liga",
    home_team: "Real Madrid",
    away_team: "Sevilla",
    offsetDays: 1,
    hour: 21,
    marketId: "MATCH_WINNER_HOME",
    markets: footballMarkets(3)
  },
  {
    match_id: "match-atm-val",
    sport_id: "football",
    league: "La Liga",
    home_team: "Atletico Madrid",
    away_team: "Valencia",
    offsetDays: 0,
    hour: 19,
    minute: 15,
    marketId: "MATCH_WINNER_HOME",
    markets: footballMarkets(4)
  },
  {
    match_id: "match-bar-vil",
    sport_id: "football",
    league: "La Liga",
    home_team: "Barcelona",
    away_team: "Villarreal",
    offsetDays: 3,
    hour: 18,
    marketId: "HOME_TOTAL_OVER_1_5",
    markets: footballMarkets(4)
  },
  {
    match_id: "match-int-mil",
    sport_id: "football",
    league: "Serie A",
    home_team: "Inter",
    away_team: "AC Milan",
    offsetDays: 2,
    hour: 20,
    minute: 45,
    marketId: "MATCH_WINNER_HOME",
    markets: footballMarkets(5)
  },
  {
    match_id: "match-juv-nap",
    sport_id: "football",
    league: "Serie A",
    home_team: "Juventus",
    away_team: "Napoli",
    offsetDays: 0,
    hour: 18,
    marketId: "BOTH_TEAMS_TO_SCORE_YES",
    markets: footballMarkets(6)
  },
  {
    match_id: "match-bay-rbl",
    sport_id: "football",
    league: "Bundesliga",
    home_team: "Bayern",
    away_team: "RB Leipzig",
    offsetDays: 4,
    hour: 19,
    isLocked: true,
    statusLabel: "Locked",
    marketId: "MATCH_WINNER_HOME",
    markets: footballMarkets(6)
  },
  {
    match_id: "match-psg-lyo",
    sport_id: "football",
    league: "Ligue 1",
    home_team: "PSG",
    away_team: "Lyon",
    offsetDays: 8,
    hour: 20,
    marketId: "MATCH_WINNER_AWAY",
    markets: footballMarkets(7)
  },
  {
    match_id: "match-dor-lev",
    sport_id: "football",
    league: "Bundesliga",
    home_team: "Dortmund",
    away_team: "Leverkusen",
    offsetDays: 1,
    hour: 16,
    marketId: "OVER_8_5_CORNERS",
    markets: footballMarkets(0)
  },
  {
    match_id: "match-lal-mia",
    sport_id: "basketball",
    league: "NBA",
    home_team: "Lakers",
    away_team: "Heat",
    offsetDays: 0,
    hour: 22,
    marketId: "SPREAD_HOME_MINUS_4_5",
    markets: basketballMarkets(0)
  },
  {
    match_id: "match-bos-mil",
    sport_id: "basketball",
    league: "NBA",
    home_team: "Celtics",
    away_team: "Bucks",
    offsetDays: 1,
    hour: 23,
    marketId: "MATCH_WINNER_2WAY",
    markets: basketballMarkets(1)
  },
  {
    match_id: "match-gsw-phx",
    sport_id: "basketball",
    league: "NBA",
    home_team: "Warriors",
    away_team: "Suns",
    offsetDays: 3,
    hour: 21,
    marketId: "TOTAL_OVER_200",
    markets: basketballMarkets(2)
  },
  {
    match_id: "match-den-dal",
    sport_id: "basketball",
    league: "NBA",
    home_team: "Nuggets",
    away_team: "Mavericks",
    offsetDays: 0,
    hour: 20,
    marketId: "MATCH_WINNER_2WAY",
    markets: basketballMarkets(0)
  },
  {
    match_id: "match-nyk-phi",
    sport_id: "basketball",
    league: "NBA",
    home_team: "Knicks",
    away_team: "76ers",
    offsetDays: 2,
    hour: 22,
    marketId: "SPREAD_HOME_MINUS_4_5",
    markets: basketballMarkets(1)
  },
  {
    match_id: "match-alc-sin",
    sport_id: "tennis",
    league: "ATP Tour",
    home_team: "Alcaraz",
    away_team: "Sinner",
    offsetDays: 0,
    hour: 15,
    marketId: "MATCH_WINNER_2WAY",
    markets: tennisMarkets(0)
  },
  {
    match_id: "match-swi-gau",
    sport_id: "tennis",
    league: "WTA Tour",
    home_team: "Swiatek",
    away_team: "Gauff",
    offsetDays: 1,
    hour: 14,
    marketId: "TOTAL_GAMES_OVER_20_5",
    markets: tennisMarkets(1)
  },
  {
    match_id: "match-djo-med",
    sport_id: "tennis",
    league: "ATP Tour",
    home_team: "Djokovic",
    away_team: "Medvedev",
    offsetDays: 2,
    hour: 16,
    marketId: "MATCH_WINNER_2WAY",
    markets: tennisMarkets(2)
  },
  {
    match_id: "match-rub-zve",
    sport_id: "tennis",
    league: "ATP Tour",
    home_team: "Rublev",
    away_team: "Zverev",
    offsetDays: 0,
    hour: 18,
    marketId: "TOTAL_GAMES_UNDER_20_5",
    markets: tennisMarkets(0)
  },
  {
    match_id: "match-peg-ryb",
    sport_id: "tennis",
    league: "WTA Tour",
    home_team: "Pegula",
    away_team: "Rybakina",
    offsetDays: 3,
    hour: 13,
    marketId: "MATCH_WINNER_2WAY",
    markets: tennisMarkets(1)
  }
];


export const createPrototypeBoard = () => ({
  fixtures: dummyMatches.map(({ offsetDays, hour, minute, isLocked, isLive, statusLabel, score, marketId, markets, ...fixture }) => fixture),
  selections: dummyMatches.map(createSelection)
});

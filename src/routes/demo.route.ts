import { FastifyInstance } from "fastify";
import { z } from "zod";
import { setContextEntry } from "../services/contextMap";
import { BoardFixture, getHighlightlyBoardData, mergeSelectionSnapshot } from "../services/highlightlyFootball";
import {
  buildOneTapSpecialMarketId,
  isOneTapSpecialMarket,
  resolveOneTapSpecialSelection
} from "../services/oneTapSpecial";
import { getAllSelections, ingestSelections } from "../services/selectionState";

const footballSpecialMarket = buildOneTapSpecialMarketId(1.5);

const sportActions = {
  football: [
    {
      action: "SOLOMON_SPECIAL",
      target_market: footballSpecialMarket,
      label: "Home & Away Over 1.5",
      description: "Builds a synthetic football prop from the home and away team total markets.",
      prominence: "featured"
    },
    {
      action: "SAFE_PLAY",
      target_market: "MATCH_WINNER_HOME",
      label: "Safe Play",
      description: "Maps one tap to the home win price for supported fixtures.",
      prominence: "secondary"
    }
  ]
} as const;

const savedDemoFixtures: Record<string, BoardFixture> = {
  "match-ars-che": {
    match_id: "match-ars-che",
    sport_id: "football",
    league: "Premier League",
    home_team: "Arsenal",
    away_team: "Chelsea"
  },
  "match-rma-sev": {
    match_id: "match-rma-sev",
    sport_id: "football",
    league: "La Liga",
    home_team: "Real Madrid",
    away_team: "Sevilla"
  },
  "match-int-mil": {
    match_id: "match-int-mil",
    sport_id: "football",
    league: "Serie A",
    home_team: "Inter",
    away_team: "AC Milan"
  },
  "match-bay-rbl": {
    match_id: "match-bay-rbl",
    sport_id: "football",
    league: "Bundesliga",
    home_team: "Bayern",
    away_team: "RB Leipzig"
  },
  "match-alc-sin": {
    match_id: "match-alc-sin",
    sport_id: "tennis",
    league: "ATP Tour",
    home_team: "Alcaraz",
    away_team: "Sinner"
  },
  "match-lal-mia": {
    match_id: "match-lal-mia",
    sport_id: "basketball",
    league: "NBA",
    home_team: "Lakers",
    away_team: "Heat"
  },
  "match-bos-mil": {
    match_id: "match-bos-mil",
    sport_id: "basketball",
    league: "NBA",
    home_team: "Celtics",
    away_team: "Bucks"
  }
};

const supportsActionTarget = (targetMarket: string, selection: Awaited<ReturnType<typeof getAllSelections>>[string]) => {
  if (isOneTapSpecialMarket(targetMarket)) {
    return Boolean(resolveOneTapSpecialSelection(selection, targetMarket));
  }

  return Boolean(selection.available_markets?.[targetMarket] || selection.market_id === targetMarket);
};

export default async function demoRoute(app: FastifyInstance) {
  app.post("/v1/otp/dev/bootstrap", async (request, reply) => {
    const schema = z.object({
      user_id: z.string().min(1).default("demo-user")
    });
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.message });
      return;
    }

    await setContextEntry({
      sportId: "football",
      action: "SAFE_PLAY",
      marketId: "MATCH_WINNER_HOME"
    });
    await setContextEntry({
      sportId: "football",
      action: "SOLOMON_SPECIAL",
      marketId: footballSpecialMarket
    });

    const existingSelections = await getAllSelections(parsed.data.user_id);

    try {
      const board = await getHighlightlyBoardData();
      const mergedSelections = board.selections.map((selection) =>
        mergeSelectionSnapshot(selection, existingSelections[selection.match_id])
      );
      const availableSportActions = {
        football: sportActions.football.filter((action) =>
          mergedSelections.some((selection) => supportsActionTarget(action.target_market, selection))
        )
      };

      await ingestSelections(parsed.data.user_id, mergedSelections);
      const snapshots = await getAllSelections(parsed.data.user_id);

      reply.send({
        ok: true,
        user_id: parsed.data.user_id,
        fixtures: board.fixtures,
        selections: snapshots,
        sport_actions: availableSportActions
      });
    } catch (error) {
      if (Object.keys(existingSelections).length > 0) {
        const fallbackSelections = existingSelections;
        const fallbackFixtures = Object.values(fallbackSelections)
          .map((selection) => savedDemoFixtures[selection.match_id])
          .filter((fixture): fixture is BoardFixture => Boolean(fixture));
        const fallbackSportActions = {
          football: sportActions.football.filter((action) =>
            Object.values(fallbackSelections).some((selection) => supportsActionTarget(action.target_market, selection))
          )
        };

        reply.send({
          ok: true,
          user_id: parsed.data.user_id,
          fixtures: fallbackFixtures,
          selections: fallbackSelections,
          sport_actions: fallbackSportActions
        });
        return;
      }

      const statusCode =
        typeof error === "object" &&
        error !== null &&
        "statusCode" in error &&
        typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
      const message = error instanceof Error ? error.message : "Unable to load the Highlightly football board.";

      reply.code(statusCode).send({ error: message });
    }
  });
}

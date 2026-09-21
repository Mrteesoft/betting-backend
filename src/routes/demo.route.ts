import { registerMockUser } from "../services/mockOdds";
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
import { createPrototypeBoard, prototypeSportActions } from "../services/prototypeBoard";

const footballSpecialMarket = buildOneTapSpecialMarketId(1.5);

const sportActions = prototypeSportActions;

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
      user_id: z.string().min(1).default("demo-user"),
      provider: z.enum(["prototype", "live"]).default("prototype")
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

    for (const [sportId, actions] of Object.entries(sportActions)) {
      for (const action of actions) await setContextEntry({ sportId, action: action.action, marketId: action.target_market });
    }
    const existing = await getAllSelections(parsed.data.user_id);
    const { fixtures: prototypeFixtures, selections: prototypeSelections } = createPrototypeBoard();
    if (parsed.data.provider === "prototype") {
      registerMockUser(parsed.data.user_id);
      await ingestSelections(parsed.data.user_id, prototypeSelections.map(selection => mergeSelectionSnapshot(selection, existing[selection.match_id])));
      reply.send({ ok: true, user_id: parsed.data.user_id, fixtures: prototypeFixtures, selections: await getAllSelections(parsed.data.user_id), sport_actions: sportActions, source: "prototype" });
      return;
    }

    const existingSelections = await getAllSelections(parsed.data.user_id);

    try {
      const board = await getHighlightlyBoardData();
      const mergedSelections = board.selections.map((selection) =>
        mergeSelectionSnapshot(selection, existingSelections[selection.match_id])
      );
      if (!mergedSelections.some((selection) => selection.odds >= 1.01 && Object.keys(selection.available_markets ?? {}).length > 0)) {
        throw Object.assign(new Error("Provider returned fixtures without bettable odds"), { statusCode: 503 });
      }
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
      if (Object.values(existingSelections).some((selection) => selection.odds >= 1.01)) {
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
      await ingestSelections(parsed.data.user_id, prototypeSelections);
      reply.send({ ok: true, user_id: parsed.data.user_id, fixtures: prototypeFixtures, selections: await getAllSelections(parsed.data.user_id), sport_actions: sportActions, source: "prototype", provider_error: error instanceof Error ? error.message : "Provider unavailable" });
    }
  });
}

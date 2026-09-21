import { serialize } from "../services/serial";
import { priceBet } from "../services/betPricing";
import { ingestSelections } from "../services/selectionState";
import {
  resolveOneTapSpecialSelection,
  isOneTapSpecialMarket,
} from "../services/oneTapSpecial";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { chooseAutoMarket } from "../services/autoMarket";
import { findBetByIdempotency, listBets, saveBet } from "../services/betStore";
import { getAllSelections } from "../services/selectionState";
import { getSportsbookAdapter } from "../services/sportsbookAdapters";
import { publishOddsUpdate, subscribeToOdds } from "../services/realtime";
import {
  cancelAutoBetRule,
  createAutoBetRule,
  listAutoBetRules,
  evaluateAutoBetRules,
} from "../services/autoBetRules";

const placeSchema = z.object({
  user_id: z.string().min(1),
  sportsbook: z.string().default("qaxiom-prototype"),
  stake: z.number().positive().max(1_000_000),
  currency: z.string().length(3).default("NGN"),
  match_ids: z.array(z.string().min(1)).min(1).max(40),
  idempotency_key: z.string().min(8).max(128),
  bet_type: z.enum(["single", "multiple", "system"]).default("multiple"),
  accept_odds_change: z.boolean().default(false),
  max_total_odds: z.number().positive().max(100000).default(100000),
});

export default async function integrationRoute(app: FastifyInstance) {
  app.get("/v1/otp/events", async (request, reply) => {
    const parsed = z
      .object({ user_id: z.string().min(1) })
      .safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.message });
    return {
      ok: true,
      events: Object.values(await getAllSelections(parsed.data.user_id)),
    };
  });

  app.post("/v1/otp/auto-market", async (request, reply) => {
    const parsed = z
      .object({
        user_id: z.string(),
        match_ids: z.array(z.string()).min(1).max(500),
        min_odds: z.number().min(1.01),
        max_odds: z.number().max(1000),
        preferred_markets: z.array(z.string()).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.message });
    const selections = await getAllSelections(parsed.data.user_id);
    return {
      ok: true,
      recommendations: parsed.data.match_ids.map((matchId) => ({
        match_id: matchId,
        market: selections[matchId]
          ? chooseAutoMarket(selections[matchId], {
              minOdds: parsed.data.min_odds,
              maxOdds: parsed.data.max_odds,
              preferredMarkets: parsed.data.preferred_markets,
            })
          : null,
      })),
    };
  });

  app.post("/v1/otp/auto-bet", async (request, reply) =>
    serialize(async () => {
      const parsed = z
        .object({
          user_id: z.string().min(1),
          sportsbook: z.string().default("qaxiom-prototype"),
          stake: z.number().positive().max(1_000_000),
          currency: z.string().length(3).default("NGN"),
          match_ids: z.array(z.string()).min(1).max(40),
          min_odds: z.number().min(1.01),
          max_odds: z.number().max(1000),
          preferred_markets: z.array(z.string()).optional(),
          idempotency_key: z.string().min(8).max(128),
        })
        .safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: parsed.error.message });
      const key = `${parsed.data.user_id}:${parsed.data.idempotency_key}`;
      const prior = await findBetByIdempotency(key);
      if (prior) return reply.send({ ok: true, replayed: true, bet: prior });
      const selections = await getAllSelections(parsed.data.user_id);
      const legs = parsed.data.match_ids.map((eventId) => {
        const snapshot = selections[eventId];
        if (!snapshot || snapshot.isLocked) return null;
        const selected = chooseAutoMarket(snapshot, {
          minOdds: parsed.data.min_odds,
          maxOdds: parsed.data.max_odds,
          preferredMarkets: parsed.data.preferred_markets,
        });
        return selected
          ? {
              eventId,
              selectionId: selected.selection_id,
              marketId: selected.market_id,
              odds: selected.odds,
            }
          : null;
      });
      if (legs.some((leg) => !leg))
        return reply
          .code(422)
          .send({
            error: "Auto Bet could not find a safe market for every event",
          });
      if (parsed.data.min_odds > parsed.data.max_odds)
        return reply
          .code(400)
          .send({ error: "Minimum odds exceed maximum odds" });
      const normalizedLegs = legs.filter(
        (leg): leg is NonNullable<typeof leg> => Boolean(leg),
      );
      if (priceBet(normalizedLegs.map((leg) => leg.odds)) > 100000)
        return reply
          .code(422)
          .send({ error: "Combined odds exceed limit. Select fewer matches." });
      const adapter = getSportsbookAdapter(parsed.data.sportsbook);
      const validation = await adapter.validateSelections(normalizedLegs);
      if (!validation.valid)
        return reply.code(422).send({ error: validation.reason });
      const bet = await adapter.placeBet({
        externalUserId: parsed.data.user_id,
        stake: parsed.data.stake,
        currency: parsed.data.currency.toUpperCase(),
        legs: normalizedLegs,
        idempotencyKey: parsed.data.idempotency_key,
      });
      await saveBet(key, bet);
      return reply
        .code(201)
        .send({ ok: true, replayed: false, automated: true, bet });
    }),
  );

  app.post("/v1/otp/auto-bet/rules", async (request, reply) => {
    const parsed = z
      .object({
        user_id: z.string().min(1),
        sportsbook: z.string().default("qaxiom-prototype"),
        match_ids: z.array(z.string()).min(1).max(40),
        stake: z.number().positive().max(1_000_000),
        currency: z.string().length(3).default("NGN"),
        target_combined_odds: z.number().min(1.01).max(100000),
        valid_hours: z.number().int().min(1).max(168),
      })
      .safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.message });
    const selections = await getAllSelections(parsed.data.user_id);
    if (
      parsed.data.match_ids.some(
        (id) => !selections[id] || selections[id].isLocked,
      )
    )
      return reply
        .code(422)
        .send({ error: "Auto Bet contains a missing or locked selection" });
    if (new Set(parsed.data.match_ids).size !== parsed.data.match_ids.length)
      return reply.code(422).send({ error: "Duplicate matches" });
    getSportsbookAdapter(parsed.data.sportsbook);
    const rule = await createAutoBetRule({
      userId: parsed.data.user_id,
      sportsbook: parsed.data.sportsbook,
      matchIds: parsed.data.match_ids,
      stake: parsed.data.stake,
      currency: parsed.data.currency.toUpperCase(),
      targetCombinedOdds: parsed.data.target_combined_odds,
      expiresAt: new Date(
        Date.now() + parsed.data.valid_hours * 3600000,
      ).toISOString(),
    });
    return reply.code(201).send({ ok: true, rule });
  });

  app.get("/v1/otp/auto-bet/rules", async (request, reply) => {
    const parsed = z
      .object({ user_id: z.string().min(1) })
      .safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.message });
    return { ok: true, rules: await listAutoBetRules(parsed.data.user_id) };
  });

  app.delete("/v1/otp/auto-bet/rules/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).safeParse(request.params);
    const query = z.object({ user_id: z.string() }).safeParse(request.query);
    if (!params.success || !query.success)
      return reply.code(400).send({ error: "Invalid rule request" });
    const rule = await cancelAutoBetRule(params.data.id, query.data.user_id);
    return rule
      ? { ok: true, rule }
      : reply.code(404).send({ error: "Auto Bet rule not found" });
  });

  app.post("/v1/otp/bets", async (request, reply) =>
    serialize(async () => {
      const parsed = placeSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: parsed.error.message });
      const prior = await findBetByIdempotency(
        `${parsed.data.user_id}:${parsed.data.idempotency_key}`,
      );
      if (prior) return reply.send({ ok: true, replayed: true, bet: prior });
      const selections = await getAllSelections(parsed.data.user_id);
      const legs = parsed.data.match_ids
        .map((id) => selections[id])
        .filter(Boolean)
        .map((s) => ({
          eventId: s.match_id,
          selectionId: s.selection_id,
          marketId: s.market_id,
          odds: s.odds,
        }));
      if (legs.length !== parsed.data.match_ids.length)
        return reply
          .code(422)
          .send({ error: "One or more selections are missing" });
      if (legs.some((leg) => selections[leg.eventId].isLocked))
        return reply
          .code(409)
          .send({ error: "One or more selections are locked" });
      const totalOdds = priceBet(
        legs.map((leg) => leg.odds),
        parsed.data.bet_type,
      );
      if (totalOdds > parsed.data.max_total_odds)
        return reply
          .code(422)
          .send({ error: "Combined odds exceed safety limit" });
      const adapter = getSportsbookAdapter(parsed.data.sportsbook);
      const validation = await adapter.validateSelections(legs);
      if (!validation.valid)
        return reply.code(422).send({ error: validation.reason });
      const bet = await adapter.placeBet({
        externalUserId: parsed.data.user_id,
        stake: parsed.data.stake,
        currency: parsed.data.currency.toUpperCase(),
        betType: parsed.data.bet_type,
        legs,
        idempotencyKey: parsed.data.idempotency_key,
      });
      await saveBet(
        `${parsed.data.user_id}:${parsed.data.idempotency_key}`,
        bet,
      );
      return reply.code(201).send({ ok: true, replayed: false, bet });
    }),
  );

  app.get("/v1/otp/bets", async (request, reply) => {
    const parsed = z
      .object({ user_id: z.string().min(1) })
      .safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ error: "user_id is required" });
    return { ok: true, bets: await listBets(parsed.data.user_id) };
  });
  app.get("/v1/otp/realtime/odds", async (request, reply) => {
    const query = z
      .object({ user_id: z.string().min(1) })
      .safeParse(request.query);
    if (!query.success)
      return reply.code(400).send({ error: "user_id is required" });
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (payload: unknown) =>
      reply.raw.write(`event: odds\ndata: ${JSON.stringify(payload)}\n\n`);
    reply.raw.write(`event: ready\ndata: {}\n\n`);
    const unsubscribe = subscribeToOdds((payload) => {
      if ((payload as { user_id: string }).user_id === query.data.user_id)
        send(payload);
    });
    const heartbeat = setInterval(
      () => reply.raw.write(": heartbeat\n\n"),
      15000,
    );
    reply.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
  app.post("/v1/otp/odds/publish", async (request, reply) => {
    const parsed = z
      .object({
        user_id: z.string().min(1),
        match_id: z.string(),
        selection_id: z.string(),
        odds: z.number().min(1.01),
        suspended: z.boolean().default(false),
      })
      .safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.message });
    const snapshot = (await getAllSelections(parsed.data.user_id))[
      parsed.data.match_id
    ];
    if (!snapshot) return reply.code(404).send({ error: "Match not found" });
    const market = Object.values(snapshot.available_markets ?? {}).find(
      (m) => m.selection_id === parsed.data.selection_id,
    );
    if (!market) return reply.code(404).send({ error: "Market not found" });
    snapshot.available_markets = {
      ...snapshot.available_markets,
      [market.market_id]: { ...market, odds: parsed.data.odds },
    };
    if (snapshot.selection_id === market.selection_id)
      snapshot.odds = parsed.data.odds;
    if (isOneTapSpecialMarket(snapshot.market_id)) {
      const special = resolveOneTapSpecialSelection(
        snapshot,
        snapshot.market_id,
      );
      if (special) {
        snapshot.special_selection = special;
        snapshot.odds = special.combined_odds;
      }
    }
    snapshot.isLocked = parsed.data.suspended;
    snapshot.updated_at = new Date().toISOString();
    await ingestSelections(parsed.data.user_id, [snapshot]);
    publishOddsUpdate({
      ...parsed.data,
      snapshot,
      timestamp: snapshot.updated_at,
    });
    await evaluateAutoBetRules();
    return reply.code(202).send({ ok: true });
  });
}

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ingestSelections, getAllSelections } from "../services/selectionState";
import { SelectionSnapshot } from "../types/otp";
import { computeCombinedOdds } from "../services/oddsWorker";

const marketOptionSchema = z.object({
  selection_id: z.string().min(1),
  market_id: z.string().min(1),
  odds: z.number(),
  line: z.number().optional()
});

const snapshotSchema = z.object({
  selection_id: z.string().min(1),
  match_id: z.string().min(1),
  sport_id: z.string().min(1),
  market_id: z.string().min(1),
  event_timestamp: z.number(),
  odds: z.number(),
  isLocked: z.boolean().default(false),
  updated_at: z.string().default(() => new Date().toISOString()),
  available_markets: z.record(z.string(), marketOptionSchema).optional(),
  score: z
    .object({
      home: z.number().int().min(0),
      away: z.number().int().min(0)
    })
    .optional()
});

export default async function selectionsRoute(app: FastifyInstance) {
  app.post("/v1/otp/selections/ingest", async (request, reply) => {
    const schema = z.object({
      user_id: z.string().min(1),
      selections: z.array(snapshotSchema).min(1)
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.message });
      return;
    }
    const snapshots = parsed.data.selections.map((s) => ({
      ...s,
      updated_at: s.updated_at || new Date().toISOString()
    })) as SelectionSnapshot[];
    const count = await ingestSelections(parsed.data.user_id, snapshots);
    reply.send({ ok: true, written: count });
  });

  app.get("/v1/otp/selections", async (request, reply) => {
    const schema = z.object({
      user_id: z.string().min(1),
      limit: z.coerce.number().int().positive().max(1000).optional()
    });
    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.message });
      return;
    }
    const selections = await getAllSelections(parsed.data.user_id);
    const entries = Object.entries(selections);
    const limit = parsed.data.limit ?? 200;
    if (entries.length > limit) {
      reply.send({
        ok: true,
        count: entries.length,
        match_ids: entries.map(([matchId]) => matchId)
      });
      return;
    }
    reply.send({ ok: true, selections });
  });

  // Demonstration endpoint for the odds worker (minimal)
  app.post("/v1/otp/odds/combined", async (request, reply) => {
    const schema = z.object({
      homeOdds: z.number().positive(),
      awayOdds: z.number().positive()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.message });
      return;
    }
    const combined = await computeCombinedOdds(parsed.data.homeOdds, parsed.data.awayOdds);
    reply.send({ ok: true, combinedOdds: combined });
  });
}

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { syncSelections } from "../services/syncSelections";

const bodySchema = z.object({
  user_id: z.string().min(1),
  sport_id: z.string().min(1),
  action: z.string().min(1),
  target_market: z.string().min(1),
  match_ids: z.array(z.string().min(1)).min(1),
  client_state_version: z.string().min(1),
  idempotency_key: z.string().min(1)
});

export default async function syncSelectionsRoute(app: FastifyInstance) {
  app.post("/v1/otp/sync-selections", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.message });
      return;
    }

    try {
      const result = await syncSelections({
        userId: parsed.data.user_id,
        sportId: parsed.data.sport_id,
        action: parsed.data.action,
        targetMarket: parsed.data.target_market,
        matchIds: parsed.data.match_ids,
        clientStateVersion: parsed.data.client_state_version,
        idempotencyKey: parsed.data.idempotency_key,
        apiKey: String(request.headers["x-api-key"] || "")
      });
      reply.send(result);
    } catch (err: any) {
      if (err.statusCode) {
        reply.code(err.statusCode).send({ error: err.message });
        return;
      }
      throw err;
    }
  });
}

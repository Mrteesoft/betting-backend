import { FastifyInstance } from "fastify";
import { z } from "zod";
import { selectMarket } from "../services/selectMarket";

const bodySchema = z.object({
  user_id: z.string().min(1),
  sport_id: z.string().min(1),
  match_id: z.string().min(1),
  target_market: z.string().min(1),
  client_state_version: z.string().min(1),
  idempotency_key: z.string().min(1)
});

export default async function selectMarketRoute(app: FastifyInstance) {
  app.post("/v1/otp/select-market", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.message });
      return;
    }

    try {
      const result = await selectMarket({
        userId: parsed.data.user_id,
        sportId: parsed.data.sport_id,
        matchId: parsed.data.match_id,
        targetMarket: parsed.data.target_market,
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

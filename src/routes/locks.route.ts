import { FastifyInstance } from "fastify";
import { z } from "zod";
import { setLockState } from "../services/selectionState";

export default async function locksRoute(app: FastifyInstance) {
  app.post("/v1/otp/locks", async (request, reply) => {
    const schema = z.object({
      user_id: z.string().min(1),
      selection_id: z.string().min(1),
      locked: z.boolean()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.message });
      return;
    }
    await setLockState(parsed.data.user_id, parsed.data.selection_id, parsed.data.locked);
    reply.send({ ok: true, locked: parsed.data.locked });
  });
}

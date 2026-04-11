import Fastify from "fastify";
import helmet from "@fastify/helmet";
import formbody from "@fastify/formbody";
import pino from "pino";
import cluster from "cluster";
import os from "os";
import { randomUUID } from "crypto";
import { env } from "./config/env";
import syncSelectionsRoute from "./routes/syncSelections.route";
import selectMarketRoute from "./routes/selectMarket.route";
import selectionsRoute from "./routes/selections.route";
import locksRoute from "./routes/locks.route";
import demoRoute from "./routes/demo.route";
import { checkRateLimit } from "./services/rateLimit";

const logger = pino({
  level: env.nodeEnv === "production" ? "info" : "debug",
  transport: env.nodeEnv === "production" ? undefined : { target: "pino-pretty" }
});

export const app = Fastify({
  logger,
  disableRequestLogging: true
});

const metrics = {
  requests: 0,
  syncCalls: 0,
  syncApplied: 0
};

app.register(helmet);
app.register(formbody);

app.addHook("onRequest", async (request, reply) => {
  const requestId = (request.headers["x-request-id"] as string) || randomUUID();
  request.id = requestId;
  (request as any).startTime = process.hrtime.bigint();
  const apiKey = request.headers["x-api-key"] as string | undefined;
  if (!apiKey || !env.apiKeys.includes(apiKey)) {
    reply.code(401).send({ error: "Unauthorized" });
    return;
  }
  await checkRateLimit(apiKey);
});

app.addHook("onResponse", async (request, reply) => {
  const start = (request as any).startTime as bigint | undefined;
  const latencyMs = start ? Number(process.hrtime.bigint() - start) / 1_000_000 : 0;
  metrics.requests += 1;
  app.log.info({
    msg: "request_complete",
    route: request.routerPath,
    statusCode: reply.statusCode,
    latencyMs,
    requestId: request.id
  });
});

app.register(async (instance) => {
  instance.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));
  instance.get("/metrics", async () => metrics);
});

app.register(syncSelectionsRoute);
app.register(selectMarketRoute);
app.register(selectionsRoute);
app.register(locksRoute);
app.register(demoRoute);

app.setErrorHandler((error, request, reply) => {
  const status = (error as any).statusCode || 500;
  request.log.error({ err: error, requestId: request.id });
  reply.status(status).send({ error: error.message || "Internal Server Error" });
});

export const start = async () => {
  try {
    await app.listen({ port: env.port, host: "0.0.0.0" });
    app.log.info(`Server listening on ${env.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

const startCluster = () => {
  const cpuCount = os.cpus().length || 1;
  if (cluster.isPrimary) {
    logger.info(`Primary ${process.pid} starting ${cpuCount} workers`);
    for (let i = 0; i < cpuCount; i += 1) {
      cluster.fork();
    }
    cluster.on("exit", (worker) => {
      logger.warn(`Worker ${worker.process.pid} died, restarting...`);
      cluster.fork();
    });
  } else {
    start();
  }
};

if (require.main === module) {
  if (env.clusterEnabled) {
    startCluster();
  } else {
    start();
  }
}

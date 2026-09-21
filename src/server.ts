import { advanceMockOdds } from "./services/mockOdds";
import { serialize } from "./services/serial";
import { evaluateAutoBetRules } from "./services/autoBetRules";
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
import integrationRoute from "./routes/integration.route";
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
  const pathname = request.raw.url?.split("?")[0];
  if (pathname === "/health") {
    return;
  }
  const apiKey = (request.headers["x-api-key"] as string | undefined) ||
    ((request.query as { api_key?: string } | undefined)?.api_key);
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
    route: request.routeOptions.url,
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
app.register(integrationRoute);
let mockOddsTimer: ReturnType<typeof setInterval> | undefined;
let autoBetTimer: ReturnType<typeof setInterval> | undefined;
app.addHook("onReady", async () => {
  autoBetTimer = setInterval(() => { void evaluateAutoBetRules().catch(error => app.log.error(error)); }, 2000);
  autoBetTimer.unref();
  if (env.nodeEnv !== "test" && process.env.OTP_MOCK_ODDS_ENABLED !== "false") {
    mockOddsTimer = setInterval(() => { void serialize(advanceMockOdds).then(evaluateAutoBetRules).catch(error => app.log.error(error)); }, 8000);
    mockOddsTimer.unref();
  }
});
app.addHook("onClose", async () => { if (autoBetTimer) clearInterval(autoBetTimer); if (mockOddsTimer) clearInterval(mockOddsTimer); });

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

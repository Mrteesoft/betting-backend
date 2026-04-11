import { parentPort } from "worker_threads";

if (!parentPort) {
  throw new Error("Worker must have parentPort");
}

parentPort.on("message", (data: { homeOdds: number; awayOdds: number }) => {
  const combinedOdds = data.homeOdds * data.awayOdds;
  parentPort?.postMessage({ combinedOdds });
});

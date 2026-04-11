import { Worker } from "worker_threads";
import { join } from "path";
import fs from "fs";

const jsPath = join(__dirname, "..", "workers", "odds.worker.js");
const tsPath = join(__dirname, "..", "workers", "odds.worker.ts");
const WORKER_PATH = fs.existsSync(jsPath) ? jsPath : tsPath;

export const computeCombinedOdds = async (homeOdds: number, awayOdds: number, timeoutMs = 200): Promise<number> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH);
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("Odds worker timeout"));
    }, timeoutMs);

    worker.once("message", (msg: { combinedOdds: number }) => {
      clearTimeout(timer);
      resolve(msg.combinedOdds);
      worker.terminate();
    });
    worker.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    worker.postMessage({ homeOdds, awayOdds });
  });

import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { BetReceipt } from "../types/sportsbook";

const storePath = resolve(process.env.OTP_DATA_FILE ?? "data/qaxiom-state.json");
type State = { bets: BetReceipt[]; idempotency: Record<string, BetReceipt> };
let state: State | null = null;
let pending = Promise.resolve();

const load = async () => {
  if (state) return state;
  try { state = JSON.parse(await readFile(storePath, "utf8")) as State; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; state = { bets: [], idempotency: {} }; }
  return state;
};

const flush = async (value: State) => {
  await mkdir(dirname(storePath), { recursive: true });
  const temporary = `${storePath}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await rename(temporary, storePath);
};

export const findBetByIdempotency = async (key: string) => (await load()).idempotency[key] ?? null;
export const saveBet = async (key: string, receipt: BetReceipt) => {
  pending = pending.catch(() => {}).then(async () => {
    const current = await load();
    if (current.idempotency[key]) return;
    current.bets.push(receipt);
    current.idempotency[key] = receipt;
    await flush(current);
  });
  await pending;
  return receipt;
};
export const listBets = async (userId?: string) => [...(await load()).bets].filter(bet => !userId || bet.userId === userId);

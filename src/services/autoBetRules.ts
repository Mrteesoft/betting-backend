import { registerMockUser } from "./mockOdds";
import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { SelectionSnapshot } from "../types/otp";
import { getAllSelections, ingestSelections } from "./selectionState";
import { getSportsbookAdapter } from "./sportsbookAdapters";
import { findBetByIdempotency, saveBet } from "./betStore";
import { serialize } from "./serial";

export type AutoBetRule = {
  id: string;
  userId: string;
  sportsbook: string;
  matchIds: string[];
  snapshots?: SelectionSnapshot[];
  selectionIds: string[];
  marketIds: string[];
  stake: number;
  currency: string;
  targetCombinedOdds: number;
  expiresAt: string;
  status: "ARMED" | "CANCELLED" | "EXECUTED" | "EXPIRED";
  createdAt: string;
  betId?: string;
};
const rulesPath = resolve(
  process.env.OTP_AUTO_BET_FILE ?? "data/auto-bet-rules.json",
);
let rules: AutoBetRule[] | null = null;
const load = async () => {
  if (rules) return rules;
  try {
    rules = JSON.parse(await readFile(rulesPath, "utf8")) as AutoBetRule[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    rules = [];
  }
  return rules;
};
const flush = async () => {
  await mkdir(dirname(rulesPath), { recursive: true });
  const temporary = `${rulesPath}.tmp`;
  await writeFile(temporary, JSON.stringify(rules, null, 2), "utf8");
  await rename(temporary, rulesPath);
};
const evaluate = async () => {
  let changed = false;
  for (const rule of await load()) {
    if (rule.status !== "ARMED") continue;
    const key = `${rule.userId}:rule:${rule.id}`;
    const prior = await findBetByIdempotency(key);
    if (prior) {
      rule.status = "EXECUTED";
      rule.betId = prior.id;
      changed = true;
      continue;
    }
    if (Date.parse(rule.expiresAt) <= Date.now()) {
      rule.status = "EXPIRED";
      changed = true;
      continue;
    }
    registerMockUser(rule.userId);
    let selections = await getAllSelections(rule.userId);
    const missing = (rule.snapshots ?? []).filter(
      (snapshot) => !selections[snapshot.match_id],
    );
    if (missing.length) {
      await ingestSelections(rule.userId, missing);
      selections = await getAllSelections(rule.userId);
    }
    const snapshots = rule.matchIds.map((id) => selections[id]);
    if (
      snapshots.some(
        (s, i) =>
          !s ||
          s.isLocked ||
          !rule.selectionIds ||
          s.selection_id !== rule.selectionIds[i] ||
          s.market_id !== rule.marketIds[i],
      )
    )
      continue;
    const odds = snapshots.reduce((total, s) => total * s.odds, 1);
    if (odds < rule.targetCombinedOdds || odds > 100000) continue;
    const legs = snapshots.map((s) => ({
      eventId: s.match_id,
      selectionId: s.selection_id,
      marketId: s.market_id,
      odds: s.odds,
    }));
    const adapter = getSportsbookAdapter(rule.sportsbook);
    const validation = await adapter.validateSelections(legs);
    if (!validation.valid) continue;
    const bet = await adapter.placeBet({
      externalUserId: rule.userId,
      stake: rule.stake,
      currency: rule.currency,
      legs,
      idempotencyKey: `rule:${rule.id}`,
    });
    await saveBet(key, bet);
    rule.status = "EXECUTED";
    rule.betId = bet.id;
    changed = true;
  }
  if (changed) await flush();
};
export const evaluateAutoBetRules = () => serialize(evaluate);
export const createAutoBetRule = (
  input: Omit<
    AutoBetRule,
    "id" | "status" | "createdAt" | "selectionIds" | "marketIds"
  >,
) =>
  serialize(async () => {
    const snapshots = await getAllSelections(input.userId);
    if (input.matchIds.some((id) => !snapshots[id] || snapshots[id].isLocked))
      throw Object.assign(new Error("Missing or locked selection"), {
        statusCode: 422,
      });
    const rule: AutoBetRule = {
      ...input,
      id: `auto_${randomUUID()}`,
      snapshots: input.matchIds.map((id) => snapshots[id]),
      selectionIds: input.matchIds.map((id) => snapshots[id].selection_id),
      marketIds: input.matchIds.map((id) => snapshots[id].market_id),
      status: "ARMED",
      createdAt: new Date().toISOString(),
    };
    (await load()).push(rule);
    await flush();
    await evaluate();
    return rule;
  });
export const listAutoBetRules = (userId: string) =>
  serialize(async () => {
    await evaluate();
    return (await load()).filter((rule) => rule.userId === userId);
  });
export const cancelAutoBetRule = (id: string, userId: string) =>
  serialize(async () => {
    const rule = (await load()).find(
      (candidate) => candidate.id === id && candidate.userId === userId,
    );
    if (!rule) return null;
    if (rule.status !== "ARMED")
      throw Object.assign(new Error("Only armed rules can be cancelled"), {
        statusCode: 409,
      });
    rule.status = "CANCELLED";
    await flush();
    return rule;
  });

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";


let app: typeof import("../src/server").app;
let dir: string;
const user = "flow-test";
const headers = { "x-api-key": "demo-test-key" };
const post = (url: string, payload: object) =>
  app.inject({ method: "POST", url, headers, payload });
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "otp-flows-"));
  process.env.OTP_DATA_FILE = join(dir, "bets.json");
  process.env.OTP_AUTO_BET_FILE = join(dir, "rules.json");
  process.env.API_KEYS = headers["x-api-key"];
  process.env.NODE_ENV = "test";
  process.env.RATE_LIMIT_PER_MINUTE = "2000";
  app = (await import("../src/server")).app;
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("complete mock betting flows", () => {
  it("boots all sports and preserves a chosen market on re-entry", async () => {
    const boot = (
      await post("/v1/otp/dev/bootstrap", { user_id: user })
    ).json();
    expect(boot.fixtures.length).toBeGreaterThan(20);
    expect(Object.keys(boot.sport_actions).sort()).toEqual([
      "basketball",
      "football",
      "tennis",
    ]);
    expect(
      Object.keys(boot.selections["match-ars-che"].available_markets),
    ).toHaveLength(15);
    const picked = await post("/v1/otp/select-market", {
      user_id: user,
      sport_id: "football",
      match_id: "match-ars-che",
      target_market: "BOTH_TEAMS_TO_SCORE_YES",
      client_state_version: "v1",
      idempotency_key: "select-test-1",
    });
    expect(picked.statusCode).toBe(200);
    expect(picked.json().applied).toBe(1);
    const again = (
      await post("/v1/otp/dev/bootstrap", { user_id: user })
    ).json();
    expect(again.selections["match-ars-che"].market_id).toBe(
      "BOTH_TEAMS_TO_SCORE_YES",
    );
  });
  it("locks prevent betting and bulk changes, then unlock restores placement", async () => {
    const selections = (
      await app.inject({ url: `/v1/otp/selections?user_id=${user}`, headers })
    ).json().selections;
    const selection = selections["match-ars-che"];
    await post("/v1/otp/locks", {
      user_id: user,
      selection_id: selection.selection_id,
      locked: true,
    });
    const payload = {
      user_id: user,
      match_ids: [selection.match_id],
      stake: 1000,
      idempotency_key: "locked-bet-test",
    };
    expect((await post("/v1/otp/bets", payload)).statusCode).toBe(409);
    const sync = await post("/v1/otp/sync-selections", {
      user_id: user,
      sport_id: "football",
      action: "SAFE_PLAY",
      target_market: "MATCH_WINNER_HOME",
      match_ids: [selection.match_id],
      client_state_version: "v1",
      idempotency_key: "locked-sync-test",
    });
    expect(sync.json().skipped_locked).toBe(1);
    await post("/v1/otp/locks", {
      user_id: user,
      selection_id: selection.selection_id,
      locked: false,
    });
    expect((await post("/v1/otp/bets", payload)).statusCode).toBe(201);
  });
  it("prices singles, accumulators and all-doubles systems and scopes history", async () => {
    const selections = (
      await app.inject({ url: `/v1/otp/selections?user_id=${user}`, headers })
    ).json().selections;
    const picks = Object.values(selections)
      .filter((s: any) => !s.isLocked)
      .slice(0, 3) as any[];
    const [a, b, c] = picks.map((s) => s.odds);
    for (const [type, expected] of [
      ["single", (a + b + c) / 3],
      ["multiple", a * b * c],
      ["system", (a * b + a * c + b * c) / 3],
    ] as const) {
      const result = await post("/v1/otp/bets", {
        user_id: user,
        match_ids: picks.map((s) => s.match_id),
        stake: 1200,
        bet_type: type,
        idempotency_key: `type-${type}-test`,
      });
      expect(result.statusCode).toBe(201);
      expect(result.json().bet.acceptedOdds).toBeCloseTo(expected, 3);
      expect(result.json().bet.betType).toBe(type);
    }
    const other = await app.inject({
      url: "/v1/otp/bets?user_id=another-user",
      headers,
    });
    expect(other.json().bets).toEqual([]);
    expect(
      (await app.inject({ url: "/v1/otp/bets", headers })).statusCode,
    ).toBe(400);
  });
  it("concurrent retries produce one receipt", async () => {
    const payload = {
      user_id: user,
      match_ids: ["match-ars-che"],
      stake: 1000,
      idempotency_key: "concurrent-replay-test",
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => post("/v1/otp/bets", payload)),
    );
    expect(new Set(results.map((r) => r.json().bet.id)).size).toBe(1);
    expect(results.filter((r) => r.json().replayed === false)).toHaveLength(1);
  });
  it("Auto Bet executes once when published odds meet its target", async () => {
    const rule = (
      await post("/v1/otp/auto-bet/rules", {
        user_id: user,
        match_ids: ["match-ars-che"],
        stake: 1000,
        target_combined_odds: 5,
        valid_hours: 1,
      })
    ).json().rule;
    expect(rule.status).toBe("ARMED");
    const selection = (
      await app.inject({ url: `/v1/otp/selections?user_id=${user}`, headers })
    ).json().selections["match-ars-che"];
    const update = {
      user_id: user,
      match_id: selection.match_id,
      selection_id: selection.selection_id,
      odds: 5.1,
    };
    expect((await post("/v1/otp/odds/publish", update)).statusCode).toBe(202);
    const rules = (
      await app.inject({
        url: `/v1/otp/auto-bet/rules?user_id=${user}`,
        headers,
      })
    ).json().rules;
    expect(rules.find((r: any) => r.id === rule.id).status).toBe("EXECUTED");
    await post("/v1/otp/odds/publish", update);
    const bets = (
      await app.inject({ url: `/v1/otp/bets?user_id=${user}`, headers })
    ).json().bets;
    expect(
      bets.filter(
        (b: any) => b.id === rules.find((r: any) => r.id === rule.id).betId,
      ),
    ).toHaveLength(1);
  });
  it("cancels armed rules and rejects invalid or duplicate bets", async () => {
    const rule = (
      await post("/v1/otp/auto-bet/rules", {
        user_id: user,
        match_ids: ["match-ars-che"],
        stake: 1000,
        target_combined_odds: 100,
        valid_hours: 1,
      })
    ).json().rule;
    const cancelled = await app.inject({
      method: "DELETE",
      url: `/v1/otp/auto-bet/rules/${rule.id}?user_id=${user}`,
      headers,
    });
    expect(cancelled.json().rule.status).toBe("CANCELLED");
    expect(
      (
        await post("/v1/otp/bets", {
          user_id: user,
          match_ids: ["match-ars-che", "match-ars-che"],
          stake: 100,
          idempotency_key: "duplicate-event-test",
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await post("/v1/otp/bets", {
          user_id: user,
          match_ids: ["match-ars-che"],
          stake: 0,
          idempotency_key: "zero-stake-test",
        })
      ).statusCode,
    ).toBe(400);
  });
});

import { describe, expect, it } from "vitest";
import { evaluateLimits, limitConfigFromEnv } from "@/lib/limits";

const cfg = { perUserPerMinute: 2, perUserPerDay: 15, globalDailyBudgetUsd: 20 };

describe("evaluateLimits", () => {
  it("allows under all limits", () => {
    expect(evaluateLimits({ userLastMinute: 0, userLastDay: 3, globalSpendTodayUsd: 1 }, cfg, 0.075)).toEqual({ allowed: true });
  });
  it("blocks bursts per minute", () => {
    expect(evaluateLimits({ userLastMinute: 2, userLastDay: 2, globalSpendTodayUsd: 0 }, cfg, 0.075)).toMatchObject({ allowed: false, reason: "user_minute" });
  });
  it("blocks at the daily per-user cap", () => {
    expect(evaluateLimits({ userLastMinute: 0, userLastDay: 15, globalSpendTodayUsd: 0 }, cfg, 0.075)).toMatchObject({ allowed: false, reason: "user_day" });
  });
  it("blocks when the next image would exceed the global budget", () => {
    expect(evaluateLimits({ userLastMinute: 0, userLastDay: 0, globalSpendTodayUsd: 19.95 }, cfg, 0.075)).toMatchObject({ allowed: false, reason: "global_budget" });
  });
  it("falls back to safe defaults on bad env values", () => {
    expect(limitConfigFromEnv({ TRYON_LIMIT_PER_USER_PER_DAY: "abc", TRYON_GLOBAL_DAILY_BUDGET_USD: "-1" })).toEqual({ perUserPerMinute: 2, perUserPerDay: 15, globalDailyBudgetUsd: 20 });
  });
});

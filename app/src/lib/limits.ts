// Usage limits & rate limiting. Counts come from the generations table (durable across
// serverless instances), so limits hold even when requests hit different machines.

export interface LimitConfig {
  perUserPerMinute: number;
  perUserPerDay: number;
  globalDailyBudgetUsd: number;
}

export interface MerchantQuota {
  used: number;        // pending + succeeded generations this billing period
  included: number;    // plan allowance (or merchant override)
  hardCap: boolean;    // block at the allowance instead of allowing overage
  status: "active" | "suspended";
}

export interface UsageSnapshot {
  userLastMinute: number;
  userLastDay: number;
  globalSpendTodayUsd: number;
  merchant?: MerchantQuota;
}

export type LimitDecision =
  | { allowed: true }
  | { allowed: false; reason: "user_minute" | "user_day" | "global_budget" | "merchant_quota" | "merchant_suspended"; message: string; retryAfterSeconds: number };

export function evaluateLimits(usage: UsageSnapshot, cfg: LimitConfig, nextCostUsd: number): LimitDecision {
  if (usage.globalSpendTodayUsd + nextCostUsd > cfg.globalDailyBudgetUsd) {
    return {
      allowed: false,
      reason: "global_budget",
      message: "Try-on is paused for today while we stay within our pilot budget. Please try again tomorrow.",
      retryAfterSeconds: secondsUntilUtcMidnight(),
    };
  }
  if (usage.merchant?.status === "suspended") {
    return { allowed: false, reason: "merchant_suspended", message: "Try-on isn't available for this store right now.", retryAfterSeconds: 3600 };
  }
  if (usage.merchant?.hardCap && usage.merchant.used >= usage.merchant.included) {
    return {
      allowed: false,
      reason: "merchant_quota",
      message: "This store has reached its try-on allowance for the month.",
      retryAfterSeconds: secondsUntilNextUtcMonth(),
    };
  }
  if (usage.userLastMinute >= cfg.perUserPerMinute) {
    return { allowed: false, reason: "user_minute", message: "You're going a bit fast. Please wait a minute.", retryAfterSeconds: 60 };
  }
  if (usage.userLastDay >= cfg.perUserPerDay) {
    return {
      allowed: false,
      reason: "user_day",
      message: `You've reached today's limit of ${cfg.perUserPerDay} try-ons.`,
      retryAfterSeconds: 24 * 3600,
    };
  }
  return { allowed: true };
}

export function limitConfigFromEnv(env: Record<string, string | undefined> = process.env): LimitConfig {
  return {
    perUserPerMinute: posInt(env.TRYON_LIMIT_PER_USER_PER_MINUTE, 2),
    perUserPerDay: posInt(env.TRYON_LIMIT_PER_USER_PER_DAY, 15),
    globalDailyBudgetUsd: posNum(env.TRYON_GLOBAL_DAILY_BUDGET_USD, 20),
  };
}

function secondsUntilUtcMidnight(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.ceil((next - now.getTime()) / 1000));
}

function secondsUntilNextUtcMonth(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.max(60, Math.ceil((next - now.getTime()) / 1000));
}

function posInt(v: string | undefined, d: number) {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : d;
}
function posNum(v: string | undefined, d: number) {
  const n = Number(v);
  return v && Number.isFinite(n) && n >= 0 ? n : d;
}

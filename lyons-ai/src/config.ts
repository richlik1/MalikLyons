import { z } from "zod";

/**
 * All configuration comes from environment variables. Nothing secret is ever
 * read from source code. Integrations whose credentials are missing are simply
 * disabled (and reported as "not configured") rather than faked.
 */
const csv = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );

const optionalString = z
  .string()
  .optional()
  .transform((s) => (s && s.trim() !== "" ? s.trim() : undefined));

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  TIMEZONE: z.string().default("America/Detroit"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /** base64-encoded 32-byte key used for AES-256-GCM encryption of OAuth tokens. */
  MASTER_ENCRYPTION_KEY: z.string().min(1, "MASTER_ENCRYPTION_KEY is required"),

  ANTHROPIC_API_KEY: optionalString,
  CLAUDE_MODEL: z.string().default("claude-opus-5-5"),
  CLAUDE_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  /** "default" enables server-side refusal fallbacks; "off" disables them. */
  CLAUDE_FALLBACKS: z.enum(["default", "off"]).default("default"),
  CLAUDE_MAX_TOKENS: z.coerce.number().int().positive().default(16000),

  TELEGRAM_BOT_TOKEN: optionalString,
  /** Numeric Telegram user id of the only person allowed to control the agent. */
  TELEGRAM_OWNER_USER_ID: z.coerce.number().int().positive().optional(),

  HTTP_HOST: z.string().default("0.0.0.0"),
  HTTP_PORT: z.coerce.number().int().positive().default(8080),
  /** Public https base URL used for the Google OAuth redirect. */
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:8080"),
  /** Long random token to sign in to the Control Center (/control). Empty = dashboard disabled. */
  CONTROL_CENTER_TOKEN: optionalString,
  /** Shared HMAC secret for n8n -> agent webhooks. */
  WEBHOOK_SHARED_SECRET: optionalString,

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,

  STAYOPS_API_BASE_URL: optionalString,
  STAYOPS_API_TOKEN: optionalString,
  /** Push owner-approved opportunities into StayOps as tasks (proposed endpoint; off until StayOps supports it). */
  STAYOPS_TASKS_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),

  BROWSER_ALLOWED_DOMAINS: csv,
  BROWSER_EXECUTABLE_PATH: optionalString,
  BROWSER_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  ARTIFACTS_DIR: z.string().default("./artifacts"),

  // --- Opportunity Intelligence ---
  OPP_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  /** Free key from SAM.gov → Account Details. Enables federal contract discovery. */
  SAM_API_KEY: optionalString,
  OPP_DISCOVERY_EVERY_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  /** Blueprint schedule (owner timezone): morning discovery + brief, evening verification + review. */
  OPP_MORNING_HOUR: z.coerce.number().int().min(0).max(23).default(7),
  OPP_EVENING_HOUR: z.coerce.number().int().min(0).max(23).default(19),
  /** Web-research units per cycle, split across departments by the allocation (30/20/15/15/10/10). */
  OPP_WEB_UNITS_PER_CYCLE: z.coerce.number().int().min(0).max(20).default(3),
  OPP_WEEKLY_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  /** Optional: raises GitHub API limits for the technology department. */
  GITHUB_TOKEN: optionalString,
  OPP_DAILY_HOUR: z.coerce.number().int().min(0).max(23).default(7),
  OPP_WEEKLY_DAY: z.coerce.number().int().min(0).max(6).default(1), // 0=Sunday
  OPP_WEEKLY_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  OPP_MAX_ALERTS_PER_DAY: z.coerce.number().int().min(0).default(2),
  OPP_DAILY_ITEMS: z.coerce.number().int().min(1).max(10).default(5),
  OPP_MAX_VERIFICATIONS_PER_RUN: z.coerce.number().int().min(1).default(40),
  OPP_WEB_RESEARCH: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  OPP_DAILY_RESEARCH_BUDGET_USD: z.coerce.number().min(0).default(1.5),

  // --- Communications ---
  /** HMAC secret shared with the macOS bridge (iMessage + storage). Empty = bridge endpoints disabled. */
  MAC_BRIDGE_SECRET: optionalString,

  // --- AI receptionist (Twilio Voice) ---
  RECEPTIONIST_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  /** Twilio Auth Token: used only to verify that webhooks really come from Twilio. */
  TWILIO_AUTH_TOKEN: optionalString,
  /** Owner's phone for urgent call transfers (E.164, e.g. +13135550100). */
  OWNER_PHONE: optionalString,
  RECEPTIONIST_MODEL: z.string().default("claude-opus-5-5"),
  RECEPTIONIST_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("low"),
  RECEPTIONIST_VOICE: z.string().default("Polly.Joanna-Neural"),
  RECEPTIONIST_MAX_TURNS: z.coerce.number().int().min(2).max(20).default(6),

  DAILY_SPEND_LIMIT_USD: z.coerce.number().positive().default(5),
  TASK_SPEND_LIMIT_USD: z.coerce.number().positive().default(1),
  TASK_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * 60_000),
  MAX_AGENT_TURNS: z.coerce.number().int().positive().default(20),
  APPROVAL_TTL_HOURS: z.coerce.number().positive().default(24),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}

/** Human-readable report of which integrations have credentials. Never prints secret values. */
export function integrationStatus(cfg: Config): Record<string, string> {
  return {
    claude: cfg.ANTHROPIC_API_KEY ? "key present (unverified until first call)" : "MISSING ANTHROPIC_API_KEY",
    telegram:
      cfg.TELEGRAM_BOT_TOKEN && cfg.TELEGRAM_OWNER_USER_ID
        ? "token + owner id present"
        : "MISSING TELEGRAM_BOT_TOKEN and/or TELEGRAM_OWNER_USER_ID",
    google: cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET ? "client configured (accounts connect via /connect)" : "not configured",
    stayops: cfg.STAYOPS_API_BASE_URL && cfg.STAYOPS_API_TOKEN ? "configured (contract unverified)" : "not configured",
    browser: cfg.BROWSER_ALLOWED_DOMAINS.length ? `allowlist: ${cfg.BROWSER_ALLOWED_DOMAINS.join(", ")}` : "disabled (empty allowlist)",
    sam_gov: cfg.SAM_API_KEY ? "key present (unverified until first call)" : "not configured (federal contract discovery off)",
    opportunities: cfg.OPP_ENABLED ? `on (web research ${cfg.OPP_WEB_RESEARCH && cfg.ANTHROPIC_API_KEY ? "on" : "off"})` : "off",
    mac_bridge: cfg.MAC_BRIDGE_SECRET ? "endpoints enabled (Mac bridge not verified)" : "disabled",
    receptionist: cfg.RECEPTIONIST_ENABLED ? (cfg.TWILIO_AUTH_TOKEN ? "enabled (Twilio not verified)" : "ENABLED BUT MISSING TWILIO_AUTH_TOKEN") : "disabled",
    n8n_webhooks: cfg.WEBHOOK_SHARED_SECRET ? "enabled" : "disabled (no WEBHOOK_SHARED_SECRET)",
  };
}

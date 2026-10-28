import type { Config } from "../config.js";
import type { LlmClient, LlmResponse } from "../core/llm.js";
import type { SourceEntry } from "./registry.js";
import { EmailAlertSource, type AlertMailbox } from "./sources/email-alerts.js";
import { GitHubSource } from "./sources/github.js";
import { GrantsGovSource } from "./sources/grants-gov.js";
import { SamGovSource } from "./sources/sam-gov.js";
import { WebResearchSource } from "./sources/web-research.js";
import type { SourceAdapter } from "./types.js";

export interface AdapterDeps {
  config: Config;
  llm: LlmClient | null;
  alertMailbox: () => Promise<AlertMailbox | null>;
  fetchImpl?: typeof fetch;
}

export interface RunHooks {
  /** Counts every outbound request for API usage limits and cost tracking. */
  countRequest: () => void;
  onUsage?: (r: LlmResponse) => Promise<void>;
}

/** Returns why a source can't run (missing key/connection), or null if it can. */
export function unavailableReason(e: SourceEntry, d: AdapterDeps): string | null {
  if (e.kind === "sam_gov" && !d.config.SAM_API_KEY) return "SAM_API_KEY not configured";
  if (e.kind === "web_research" && (!d.llm || !d.config.OPP_WEB_RESEARCH)) return "web research needs ANTHROPIC_API_KEY (and OPP_WEB_RESEARCH=true)";
  return null;
}

/** Builds a fresh adapter for one run, with a request-counting fetch. */
export function buildAdapter(e: SourceEntry, d: AdapterDeps, hooks: RunHooks): SourceAdapter | null {
  const base = d.fetchImpl ?? fetch;
  let used = 0;
  const counted = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    used++;
    if (used > e.max_requests_per_run) throw new Error(`${e.id}: per-run request limit (${e.max_requests_per_run}) reached`);
    hooks.countRequest();
    return base(input, init);
  }) as typeof fetch;

  switch (e.kind) {
    case "grants_gov":
      return new GrantsGovSource(counted);
    case "sam_gov":
      return d.config.SAM_API_KEY ? new SamGovSource(d.config.SAM_API_KEY, counted) : null;
    case "github":
      return new GitHubSource({ token: d.config.GITHUB_TOKEN, fetchImpl: counted, queries: e.config.queries, maxRequests: e.max_requests_per_run });
    case "email_alerts":
      return new EmailAlertSource(e, d.alertMailbox);
    case "web_research":
      if (!d.llm || !d.config.OPP_WEB_RESEARCH) return null;
      return new WebResearchSource(d.llm, { fetchImpl: counted, onUsage: hooks.onUsage }).forEntry({
        id: e.id,
        category: e.config.category ?? "business_ideas",
        brief: e.config.brief,
        domains: e.domains,
        opportunityType: e.opportunity_type,
      });
  }
}

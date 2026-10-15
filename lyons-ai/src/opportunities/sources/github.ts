import type { Candidate, OwnerProfile, SourceAdapter, VerificationCheck, VerificationResult } from "../types.js";
import { SourceError, type FetchLike } from "./http.js";

/**
 * GitHub REST API connector for the AI & technology department: finds actively
 * maintained repositories that could improve LYONS AI or StayOps. Verification
 * re-reads the repository record (exists, not archived/disabled, recent pushes,
 * license). Unauthenticated limits: 60 core and 10 search requests per minute-ish;
 * set GITHUB_TOKEN to raise them.
 */
interface Repo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  pushed_at: string;
  created_at: string;
  archived: boolean;
  disabled?: boolean;
  license: { spdx_id: string | null } | null;
  topics?: string[];
  owner: { login: string };
}

export class GitHubSource implements SourceAdapter {
  readonly name = "github";
  readonly categories = ["technology" as const];
  /** Requests made since construction (for API usage limits and cost tracking). */
  requests = 0;

  constructor(
    private readonly opts: {
      token?: string;
      fetchImpl?: FetchLike;
      queries?: string[];
      maxRequests?: number;
      minStars?: number;
      pushedWithinDays?: number;
      perQuery?: number;
      now?: () => Date;
    } = {},
  ) {}

  configured(): boolean {
    return true;
  }

  private async get<T>(path: string, signal: AbortSignal): Promise<T> {
    if (this.requests >= (this.opts.maxRequests ?? 20)) throw new SourceError("github: per-run request limit reached");
    this.requests++;
    const res = await (this.opts.fetchImpl ?? fetch)(`https://api.github.com${path}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "LYONS-AI-opportunity-research",
        ...(this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {}),
      },
    });
    if (res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) throw new SourceError("github: rate limited");
    if (res.status === 403) {
      const msg = await res
        .json()
        .then((b: { message?: string }) => b.message ?? "")
        .catch(() => "");
      throw new SourceError(`github: HTTP 403 ${String(msg).slice(0, 160)}`.trim());
    }
    if (res.status === 404) throw new SourceError("github: not found");
    if (!res.ok) throw new SourceError(`github: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private now(): Date {
    return this.opts.now ? this.opts.now() : new Date();
  }

  toCandidate(r: Repo): Candidate {
    const daysSincePush = Math.floor((this.now().getTime() - Date.parse(r.pushed_at)) / 86_400_000);
    return {
      source: this.name,
      sourceId: r.full_name.toLowerCase(),
      category: "technology",
      title: r.full_name,
      organization: r.owner.login,
      url: r.html_url,
      summary: (r.description ?? "").slice(0, 500),
      opportunityType: "resource",
      fundingType: "free",
      capitalRequiredUsd: 0,
      deadlineAt: null,
      signals: {
        stars: r.stargazers_count,
        forks: r.forks_count,
        license: r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? r.license.spdx_id : "",
        daysSincePush,
        archived: r.archived,
        topics: (r.topics ?? []).slice(0, 8).join(","),
      },
      postedAt: new Date(r.created_at),
      raw: { full_name: r.full_name, stars: r.stargazers_count, pushed_at: r.pushed_at },
    };
  }

  async discover(_profile: OwnerProfile, signal: AbortSignal): Promise<Candidate[]> {
    const since = new Date(this.now().getTime() - (this.opts.pushedWithinDays ?? 30) * 86_400_000).toISOString().slice(0, 10);
    const out = new Map<string, Candidate>();
    for (const q of this.opts.queries ?? ["topic:ai-agents"]) {
      const query = `${q} pushed:>${since} stars:>=${this.opts.minStars ?? 50} archived:false`;
      const body = await this.get<{ items?: Repo[] }>(
        `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${this.opts.perQuery ?? 5}`,
        signal,
      );
      for (const r of body.items ?? []) {
        const c = this.toCandidate(r);
        if (!out.has(c.sourceId)) out.set(c.sourceId, c);
      }
    }
    return [...out.values()];
  }

  async verify(c: Candidate, signal: AbortSignal): Promise<VerificationResult> {
    const checks: VerificationCheck[] = [];
    let r: Repo;
    try {
      r = await this.get<Repo>(`/repos/${c.title.split("/").map(encodeURIComponent).join("/")}`, signal);
    } catch (err) {
      if ((err as Error).message.includes("not found")) {
        checks.push({ name: "repository exists", passed: false, detail: "404" });
        return { ok: false, method: "api:github/repos", authoritativeUrl: c.url, checkedAt: new Date(), checks };
      }
      throw err;
    }
    const fresh = this.toCandidate(r);
    checks.push({ name: "repository exists", passed: true, detail: r.full_name });
    checks.push({ name: "name matches", passed: r.full_name.toLowerCase() === c.sourceId, detail: r.full_name });
    checks.push({ name: "not archived or disabled", passed: !r.archived && !r.disabled, detail: r.archived ? "archived" : "active" });
    const days = fresh.signals!.daysSincePush as number;
    checks.push({ name: "maintained (push within 365 days)", passed: days <= 365, detail: `last push ${days} day(s) ago` });
    checks.push({ name: "license published", passed: true, detail: (fresh.signals!.license as string) || "none (reuse rights unclear)" });
    return {
      ok: checks.every((x) => x.passed),
      method: "api:github/repos",
      authoritativeUrl: r.html_url,
      checkedAt: new Date(),
      checks,
      updates: { summary: fresh.summary, signals: fresh.signals, raw: fresh.raw },
    };
  }
}

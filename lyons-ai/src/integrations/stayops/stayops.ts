import { z } from "zod";
import type { ToolDefinition } from "../../core/types.js";
import { wrapUntrusted } from "../../security/untrusted.js";

/**
 * StayOps adapter — READ-ONLY, business scope only.
 *
 * No StayOps code or API was available when this was written, so the endpoint
 * contract below is a PROPOSAL (see docs/STAYOPS_INTEGRATION.md). It must be
 * confirmed against the real StayOps API and a scoped, read-only token before
 * use. Until STAYOPS_API_BASE_URL and STAYOPS_API_TOKEN are set the tool is not
 * registered at all.
 *
 *   GET {base}/api/agent/v1/{turnovers|jobs|inspections}?from=ISO&to=ISO
 *   Authorization: Bearer <read-only agent token>
 *   200 -> { "items": [ { ... } ] }
 */
export const STAYOPS_RESOURCES = ["turnovers", "jobs", "inspections"] as const;

export class StayOpsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async list(resource: (typeof STAYOPS_RESOURCES)[number], from: string, to: string, signal?: AbortSignal): Promise<unknown[]> {
    const url = new URL(`/api/agent/v1/${resource}`, this.baseUrl);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    const res = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${this.token}`, accept: "application/json" },
      signal,
      redirect: "error",
    });
    if (!res.ok) throw new Error(`StayOps ${resource} request failed: HTTP ${res.status}`);
    const body = (await res.json()) as { items?: unknown[] };
    if (!Array.isArray(body.items)) throw new Error("StayOps response did not match the expected contract ({ items: [] }).");
    return body.items;
  }
}

/**
 * Proposed write endpoint for owner-approved opportunities (see STAYOPS_INTEGRATION.md):
 *   POST {base}/api/agent/v1/tasks  { title, description, due_at, external_ref }  → 201 { id }
 * Disabled unless STAYOPS_TASKS_ENABLED=true and the token has the tasks:write scope.
 * external_ref makes the call idempotent on the StayOps side.
 */
export class StayOpsTaskClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createTask(t: { title: string; description: string; dueAt: Date | null; externalRef: string }): Promise<{ id: string }> {
    const res = await this.fetchImpl(new URL("/api/agent/v1/tasks", this.baseUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json", "idempotency-key": t.externalRef },
      body: JSON.stringify({ title: t.title, description: t.description, due_at: t.dueAt?.toISOString() ?? null, external_ref: t.externalRef }),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`StayOps task creation failed: HTTP ${res.status}`);
    const body = (await res.json()) as { id?: string };
    if (!body.id) throw new Error("StayOps response did not include a task id");
    return { id: body.id };
  }
}

export function stayOpsTools(client: StayOpsClient): ToolDefinition[] {
  const input = z.object({
    resource: z.enum(STAYOPS_RESOURCES),
    from: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "ISO date-time"),
    to: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "ISO date-time"),
  });
  const tool: ToolDefinition<z.infer<typeof input>> = {
    name: "stayops_list",
    description: "Read StayOps turnovers, jobs (with cleaner assignments), or inspections in a date range. Read-only.",
    input,
    risk: "read",
    dataClasses: ["client_pii", "business_internal"],
    scopes: ["business"],
    idempotent: true,
    describeAction: (i) => `Read StayOps ${i.resource} ${i.from} → ${i.to}`,
    async run(i, ctx) {
      const items = await client.list(i.resource, i.from, i.to, ctx.signal);
      if (!items.length) return { content: `No StayOps ${i.resource} in this range.` };
      return { content: wrapUntrusted(`stayops:${i.resource}`, JSON.stringify(items.slice(0, 200), null, 1)) };
    },
  };
  return [tool];
}

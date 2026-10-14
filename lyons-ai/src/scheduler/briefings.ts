import type { Scope } from "../core/types.js";
import type { Store, TaskRow } from "../db/store.js";

export type BriefingKind = "morning" | "evening";

/** YYYY-MM-DD in the owner's timezone; used as the once-per-day idempotency key. */
export function localDate(timeZone: string, d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function briefingPrompt(kind: BriefingKind, openTasks: TaskRow[]): string {
  const open = openTasks.length
    ? openTasks.map((t) => `- ${t.title} [${t.status}] (id ${t.id.slice(0, 8)})`).join("\n")
    : "- none";
  if (kind === "morning") {
    return `Prepare my MORNING briefing.
1. Today's calendar in time order, plus any conflicts (use calendar_find_conflicts for today).
2. Email: search for unread messages from the last 24 hours. Summarise the ones that matter (clients, guests, vendors, payments, StayOps), and say which need a reply from me. Do not draft replies unless I've asked.
3. StayOps: today's and tomorrow's turnovers and jobs, flagging unassigned cleaners and tight turnovers. If StayOps is not available, say so in one line.
4. My open LYONS AI tasks (below), especially anything awaiting my approval.
Finish with "Top 3 priorities today".

Open tasks:
${open}`;
  }
  return `Prepare my EVENING briefing.
1. Tomorrow's calendar in time order, with conflicts and anything I need to prepare.
2. Email: anything important from today that still looks unanswered.
3. StayOps: tomorrow's turnovers/jobs and any unassigned cleaners. If StayOps is not available, say so in one line.
4. My open LYONS AI tasks (below).
Finish with "Tomorrow's first move".

Open tasks:
${open}`;
}

/**
 * Creates the briefing task at most once per (kind, scope, local date), so a
 * retried n8n trigger never produces a duplicate briefing.
 */
export async function triggerBriefing(
  store: Store,
  opts: { kind: BriefingKind; scope: Scope; timeZone: string; chatId: number | null; force?: boolean; now?: Date },
): Promise<{ created: true; task: TaskRow } | { created: false; reason: string }> {
  const date = localDate(opts.timeZone, opts.now);
  const runKey = `${opts.kind}:${opts.scope}:${date}${opts.force ? `:manual:${Date.now()}` : ""}`;
  if (!(await store.claimScheduledRun("briefing", runKey))) {
    return { created: false, reason: `The ${opts.kind} ${opts.scope} briefing for ${date} already ran.` };
  }
  const open = await store.openTasks();
  const task = await store.createTask({
    title: `${opts.kind === "morning" ? "Morning" : "Evening"} briefing (${opts.scope}) ${date}`,
    input: briefingPrompt(opts.kind, open),
    scope: opts.scope,
    source: opts.force ? "telegram" : "schedule",
    chatId: opts.chatId,
  });
  await store.attachScheduledRunTask("briefing", runKey, task.id);
  return { created: true, task };
}

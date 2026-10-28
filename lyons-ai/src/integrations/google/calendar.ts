import { calendar, type calendar_v3 } from "@googleapis/calendar";
import { z } from "zod";
import type { ToolDefinition } from "../../core/types.js";
import { wrapUntrusted } from "../../security/untrusted.js";
import type { GoogleAuthManager } from "./oauth.js";

export interface SimpleEvent {
  id: string;
  summary: string;
  start: string; // ISO date-time, or YYYY-MM-DD for all-day
  end: string;
  allDay: boolean;
  busy: boolean;
  location?: string;
  attendees?: string[];
}

export function toSimpleEvent(e: calendar_v3.Schema$Event): SimpleEvent {
  const allDay = Boolean(e.start?.date && !e.start?.dateTime);
  const selfDeclined = e.attendees?.some((a) => a.self && a.responseStatus === "declined") ?? false;
  return {
    id: e.id ?? "",
    summary: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    allDay,
    busy: e.transparency !== "transparent" && !selfDeclined && e.status !== "cancelled",
    location: e.location ?? undefined,
    attendees: e.attendees?.map((a) => a.email ?? "").filter(Boolean),
  };
}

export interface Conflict {
  a: SimpleEvent;
  b: SimpleEvent;
  overlapMinutes: number;
}

/** Pairwise overlap among busy, timed events. All-day events are informational, not conflicts. */
export function findConflicts(events: SimpleEvent[]): Conflict[] {
  const timed = events
    .filter((e) => e.busy && !e.allDay && e.start && e.end)
    .map((e) => ({ e, s: Date.parse(e.start), t: Date.parse(e.end) }))
    .filter((x) => Number.isFinite(x.s) && Number.isFinite(x.t) && x.t > x.s)
    .sort((x, y) => x.s - y.s);
  const out: Conflict[] = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const A = timed[i]!;
      const B = timed[j]!;
      if (B.s >= A.t) break; // sorted by start: no later event can overlap A
      out.push({ a: A.e, b: B.e, overlapMinutes: Math.round((Math.min(A.t, B.t) - B.s) / 60_000) });
    }
  }
  return out;
}

export function formatEvents(events: SimpleEvent[], timeZone: string): string {
  if (!events.length) return "No events in this range.";
  const fmt = (iso: string, allDay: boolean) =>
    allDay ? iso : new Date(iso).toLocaleString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return events
    .map((e) => {
      const when = e.allDay ? `${e.start} (all day)` : `${fmt(e.start, false)} – ${fmt(e.end, false)}`;
      const extra = [e.location ? `location: ${e.location}` : "", e.attendees?.length ? `attendees: ${e.attendees.join(", ")}` : "", e.busy ? "" : "free/declined"]
        .filter(Boolean)
        .join("; ");
      return `- ${when} | ${e.summary}${extra ? ` | ${extra}` : ""} [id ${e.id}]`;
    })
    .join("\n");
}

const isoDateTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO 8601 date-time");

async function listEvents(auth: GoogleAuthManager, scope: "business" | "personal", start: string, end: string, max = 100): Promise<SimpleEvent[]> {
  const api = calendar({ version: "v3", auth: await auth.clientFor(scope) });
  const res = await api.events.list({
    calendarId: "primary",
    timeMin: new Date(start).toISOString(),
    timeMax: new Date(end).toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: max,
  });
  return (res.data.items ?? []).map(toSimpleEvent);
}

/** Calendar event ids must be base32hex (a-v, 0-9); a UUID's hex digits qualify. */
export function eventIdFromKey(key: string): string {
  return `lc${key.replace(/-/g, "").toLowerCase()}`;
}

export function calendarTools(auth: GoogleAuthManager): ToolDefinition[] {
  const range = z.object({
    start: isoDateTime.describe("Range start, ISO 8601 with offset, e.g. 2026-10-14T00:00:00-04:00"),
    end: isoDateTime.describe("Range end, ISO 8601 with offset"),
  });

  const list: ToolDefinition<z.infer<typeof range>> = {
    name: "calendar_list_events",
    description: "List events on the task scope's Google Calendar (primary) between start and end.",
    input: range,
    risk: "read",
    dataClasses: ["client_pii", "personal"],
    idempotent: true,
    describeAction: (i) => `List calendar events ${i.start} → ${i.end}`,
    async run(i, ctx) {
      const events = await listEvents(auth, ctx.scope, i.start, i.end);
      // Event titles/locations can be set by outside invitees: treat as untrusted.
      return { content: wrapUntrusted(`google_calendar:${ctx.scope}`, formatEvents(events, ctx.config.TIMEZONE)) };
    },
  };

  const conflicts: ToolDefinition<z.infer<typeof range>> = {
    name: "calendar_find_conflicts",
    description: "Find overlapping busy events on the task scope's calendar between start and end.",
    input: range,
    risk: "read",
    dataClasses: ["client_pii", "personal"],
    idempotent: true,
    describeAction: (i) => `Check calendar conflicts ${i.start} → ${i.end}`,
    async run(i, ctx) {
      const found = findConflicts(await listEvents(auth, ctx.scope, i.start, i.end, 250));
      if (!found.length) return { content: "No conflicts found." };
      const text = found
        .map((c) => `- "${c.a.summary}" (${c.a.start}–${c.a.end}) overlaps "${c.b.summary}" (${c.b.start}–${c.b.end}) by ${c.overlapMinutes} min`)
        .join("\n");
      return { content: wrapUntrusted(`google_calendar:${ctx.scope}`, text) };
    },
  };

  const createInput = z.object({
    summary: z.string().min(1).max(300),
    start: isoDateTime,
    end: isoDateTime,
    description: z.string().max(5000).optional(),
    location: z.string().max(300).optional(),
    attendees: z.array(z.string().email()).max(50).optional().describe("Invitees. They will receive an invitation email."),
  });

  const create: ToolDefinition<z.infer<typeof createInput>> = {
    name: "calendar_create_event",
    description: "Create an event on the task scope's primary calendar. Invitations are emailed to attendees. Requires owner approval.",
    input: createInput,
    risk: "external_communication",
    dataClasses: ["client_pii", "personal"],
    // A deterministic event id makes a retried insert a no-op (409) instead of a duplicate.
    idempotent: true,
    describeAction: (i) =>
      `Create calendar event "${i.summary}" ${i.start} → ${i.end}${i.attendees?.length ? ` and email invites to ${i.attendees.join(", ")}` : " (no invitees)"}`,
    async run(i, ctx) {
      if (Date.parse(i.end) <= Date.parse(i.start)) return { content: "end must be after start", isError: true };
      const api = calendar({ version: "v3", auth: await auth.clientFor(ctx.scope) });
      const id = eventIdFromKey(ctx.idempotencyKey);
      try {
        const res = await api.events.insert({
          calendarId: "primary",
          sendUpdates: i.attendees?.length ? "all" : "none",
          requestBody: {
            id,
            summary: i.summary,
            description: i.description,
            location: i.location,
            start: { dateTime: new Date(i.start).toISOString(), timeZone: ctx.config.TIMEZONE },
            end: { dateTime: new Date(i.end).toISOString(), timeZone: ctx.config.TIMEZONE },
            attendees: i.attendees?.map((email) => ({ email })),
          },
        });
        return { content: `Created event "${res.data.summary}" (id ${res.data.id}). Link: ${res.data.htmlLink ?? "n/a"}` };
      } catch (err) {
        if ((err as { code?: number }).code === 409) return { content: `Event already exists (id ${id}); not created twice.` };
        throw err;
      }
    },
  };

  return [list, conflicts, create];
}

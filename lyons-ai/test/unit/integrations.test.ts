import { describe, expect, it } from "vitest";
import { checkUrl, hostAllowed } from "../../src/integrations/browser/page-snapshot.js";
import { eventIdFromKey, findConflicts, toSimpleEvent, type SimpleEvent } from "../../src/integrations/google/calendar.js";
import { buildMime, extractBody, htmlToText } from "../../src/integrations/google/gmail.js";
import { StayOpsClient } from "../../src/integrations/stayops/stayops.js";
import { briefingPrompt, localDate } from "../../src/scheduler/briefings.js";
import { approvalCallbackData, chunkMessage, isOwner, parseApprovalCallback, parseRemember, taskTitle } from "../../src/telegram/parse.js";

const ev = (id: string, start: string, end: string, extra: Partial<SimpleEvent> = {}): SimpleEvent => ({
  id,
  summary: id,
  start,
  end,
  allDay: false,
  busy: true,
  ...extra,
});

describe("calendar conflicts", () => {
  it("finds overlapping busy events, including chains", () => {
    const c = findConflicts([
      ev("a", "2026-10-14T09:00:00-04:00", "2026-10-14T10:00:00-04:00"),
      ev("b", "2026-10-14T09:30:00-04:00", "2026-10-14T11:00:00-04:00"),
      ev("c", "2026-10-14T10:45:00-04:00", "2026-10-14T11:30:00-04:00"),
      ev("d", "2026-10-14T12:00:00-04:00", "2026-10-14T13:00:00-04:00"),
    ]);
    expect(c.map((x) => `${x.a.id}-${x.b.id}:${x.overlapMinutes}`)).toEqual(["a-b:30", "b-c:15"]);
  });

  it("treats back-to-back as no conflict and ignores free, declined and all-day events", () => {
    expect(
      findConflicts([
        ev("a", "2026-10-14T09:00:00Z", "2026-10-14T10:00:00Z"),
        ev("b", "2026-10-14T10:00:00Z", "2026-10-14T11:00:00Z"),
        ev("free", "2026-10-14T09:00:00Z", "2026-10-14T11:00:00Z", { busy: false }),
        ev("allday", "2026-10-14", "2026-10-15", { allDay: true }),
      ]),
    ).toEqual([]);
  });

  it("maps Google events, marking declined invitations as not busy", () => {
    const e = toSimpleEvent({
      id: "x",
      summary: "Walkthrough",
      start: { dateTime: "2026-10-14T09:00:00Z" },
      end: { dateTime: "2026-10-14T10:00:00Z" },
      attendees: [{ email: "me@x.com", self: true, responseStatus: "declined" }],
    });
    expect(e).toMatchObject({ busy: false, allDay: false, attendees: ["me@x.com"] });
  });

  it("derives a valid base32hex event id from the idempotency key", () => {
    const id = eventIdFromKey("3f2b9c1e-0d4a-4b8e-9a7f-1c2d3e4f5a6b");
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(eventIdFromKey("3f2b9c1e-0d4a-4b8e-9a7f-1c2d3e4f5a6b")).toBe(id);
  });
});

describe("gmail helpers", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64url");

  it("prefers text/plain in a multipart tree", () => {
    const body = extractBody({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/html", body: { data: b64("<p>HTML</p>") } },
        { mimeType: "text/plain", body: { data: b64("Plain text") } },
      ],
    });
    expect(body).toBe("Plain text");
  });

  it("falls back to HTML converted to text, dropping scripts", () => {
    expect(htmlToText("<style>x{}</style><p>Hello&nbsp;there</p><script>alert(1)</script><br>Bye")).toBe("Hello there\n\nBye");
  });

  it("builds a MIME message and blocks header injection", () => {
    const mime = buildMime({ to: ["a@b.com"], subject: "Turnover – Friday", body: "Hi\nThere", inReplyTo: "<m1@x>" });
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(mime).toContain("In-Reply-To: <m1@x>");
    expect(mime).toContain("\r\n\r\nHi\r\nThere");
    expect(() => buildMime({ to: ["a@b.com"], subject: "x\r\nBcc: evil@x.com", body: "b" })).toThrow(/newline/);
  });
});

describe("browser allowlist", () => {
  const allow = ["example.com", "airbnb.com"];
  it("matches exact hosts and subdomains only", () => {
    expect(hostAllowed("example.com", allow)).toBe(true);
    expect(hostAllowed("www.airbnb.com", allow)).toBe(true);
    expect(hostAllowed("evilexample.com", allow)).toBe(false);
    expect(hostAllowed("example.com.evil.net", allow)).toBe(false);
  });

  it("rejects non-http protocols, embedded credentials, off-list hosts, and an empty allowlist", () => {
    expect(checkUrl("https://example.com/a", allow).ok).toBe(true);
    expect(checkUrl("file:///etc/passwd", allow).ok).toBe(false);
    expect(checkUrl("javascript:alert(1)", allow).ok).toBe(false);
    expect(checkUrl("https://user:pw@example.com", allow).ok).toBe(false);
    expect(checkUrl("https://google.com", allow).ok).toBe(false);
    expect(checkUrl("https://example.com", []).ok).toBe(false);
  });
});

describe("StayOps client", () => {
  it("calls the read-only contract with a bearer token", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const fake = (async (url: URL, init: RequestInit) => {
      seen = { url: url.toString(), auth: new Headers(init.headers).get("authorization") };
      return new Response(JSON.stringify({ items: [{ id: 1 }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const items = await new StayOpsClient("https://stayops.example", "tok", fake).list("turnovers", "2026-10-14", "2026-10-15");
    expect(items).toEqual([{ id: 1 }]);
    expect(seen).toEqual({ url: "https://stayops.example/api/agent/v1/turnovers?from=2026-10-14&to=2026-10-15", auth: "Bearer tok" });
  });

  it("fails loudly on errors and contract mismatches instead of inventing data", async () => {
    const err = (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
    await expect(new StayOpsClient("https://s.example", "t", err).list("jobs", "a", "b")).rejects.toThrow(/HTTP 403/);
    const bad = (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch;
    await expect(new StayOpsClient("https://s.example", "t", bad).list("jobs", "a", "b")).rejects.toThrow(/contract/);
  });
});

describe("telegram parsing", () => {
  it("accepts only the owner in a private chat", () => {
    expect(isOwner(42, "private", 42)).toBe(true);
    expect(isOwner(42, "group", 42)).toBe(false);
    expect(isOwner(43, "private", 42)).toBe(false);
    expect(isOwner(42, "private", undefined)).toBe(false);
  });

  it("round-trips approval callback data within Telegram's 64-byte limit", () => {
    const id = "3f2b9c1e-0d4a-4b8e-9a7f-1c2d3e4f5a6b";
    const data = approvalCallbackData(id, true);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(parseApprovalCallback(data)).toEqual({ approvalId: id, approve: true });
    expect(parseApprovalCallback("ap:not-a-uuid:y")).toBeNull();
  });

  it("parses /remember", () => {
    expect(parseRemember("client Acme Rentals: invoices on the 1st")).toEqual({ kind: "client", subject: "Acme Rentals", content: "invoices on the 1st" });
    expect(parseRemember("pet Rex: good boy")).toBeNull();
  });

  it("chunks long messages and titles tasks", () => {
    const parts = chunkMessage(("line\n".repeat(2000)).trim(), 4000);
    expect(parts.every((p) => p.length <= 4000)).toBe(true);
    expect(parts.join("\n")).toBe(("line\n".repeat(2000)).trim());
    expect(taskTitle("x".repeat(100))).toHaveLength(60);
  });
});

describe("briefings", () => {
  it("computes the local date in the owner's timezone", () => {
    // 02:00 UTC on Oct 15 is still Oct 14 in New York.
    expect(localDate("America/New_York", new Date("2026-10-15T02:00:00Z"))).toBe("2026-10-14");
  });

  it("builds morning and evening prompts", () => {
    expect(briefingPrompt("morning", [])).toContain("Top 3 priorities today");
    expect(briefingPrompt("evening", [])).toContain("Tomorrow's first move");
  });
});

"use client";

// Anonymous first-party visitor id for conversion measurement (no third-party cookies).
export function getVisitorId(): string {
  const key = "ts_vid";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function utmSource(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("utm_source")?.slice(0, 100) ?? undefined;
}

export function track(event: "page_view" | "cta_click", variant?: string) {
  const body = JSON.stringify({ visitorId: getVisitorId(), event, variant, path: window.location.pathname, utmSource: utmSource() });
  fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio request validation: HMAC-SHA1 (key = Auth Token) over the full request
 * URL followed by each POST parameter name+value, sorted by name; base64.
 * Cross-checked against the official `twilio` package in tests.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function validTwilioRequest(authToken: string, url: string, params: Record<string, string>, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function twiml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

export function say(text: string, voice: string): string {
  return `<Say voice="${xml(voice)}">${xml(text)}</Say>`;
}

export function gather(prompt: string, voice: string, action: string): string {
  return `<Gather input="speech" action="${xml(action)}" method="POST" speechTimeout="auto" timeout="6" language="en-US" actionOnEmptyResult="true">${say(prompt, voice)}</Gather>`;
}

import twilio from "twilio";
import { describe, expect, it } from "vitest";
import { isFreeMailDomain, looksLikeRequest, matchObservation, nameTokens, normalizeEmail, normalizePhone } from "../../src/clients/identity.js";
import { normalizeRecipient, validateRules } from "../../src/clients/policies.js";
import { formatBytes } from "../../src/device/storage.js";
import { classifyMessage, decideAction, parseUnsubscribe, type MessageMeta } from "../../src/gmail-cleanup/classify.js";
import { guardReply, parseTurn, preRoute, SAFE_COMMIT, SAFE_PRICE } from "../../src/receptionist/brain.js";
import { gather, twilioSignature, validTwilioRequest, xml } from "../../src/receptionist/twilio.js";

const ctx = { clientEmails: new Set(["nicole@acmerentals.com"]), clientDomains: new Set(["acmerentals.com"]) };
const NOW = new Date("2026-10-15T12:00:00Z");
const daysAgo = (n: number) => NOW.getTime() - n * 86_400_000;
const msg = (over: Partial<MessageMeta>): MessageMeta => ({ id: "m", labelIds: ["INBOX"], from: "Shop <deals@shop.example>", subject: "Big sale", internalDate: daysAgo(60), ...over });

describe("Gmail cleanup classification", () => {
  it("protects business records even when they look like promotions", () => {
    expect(classifyMessage(msg({ labelIds: ["INBOX", "CATEGORY_PROMOTIONS"], subject: "Your invoice #4411 is ready" }), ctx)).toEqual({ category: "invoice", protected: "invoice/billing record" });
    expect(classifyMessage(msg({ subject: "Your order confirmation" }), ctx).protected).toMatch(/receipt/);
    expect(classifyMessage(msg({ subject: "Please sign: cleaning services agreement via DocuSign" }), ctx).category).toBe("legal");
    expect(classifyMessage(msg({ subject: "Your 1099 tax form" }), ctx).category).toBe("financial");
    expect(classifyMessage(msg({ from: "Nicole <nicole@acmerentals.com>", labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] }), ctx).category).toBe("client");
    expect(classifyMessage(msg({ from: "billing@acmerentals.com" }), ctx).category).toBe("client"); // company domain
    expect(classifyMessage(msg({ from: "someone@gmail.com" }), { clientEmails: new Set(), clientDomains: new Set(["gmail.com"]) }).category).not.toBe("client");
  });

  it("protects starred, user-labelled and important mail", () => {
    expect(classifyMessage(msg({ labelIds: ["INBOX", "CATEGORY_PROMOTIONS", "STARRED"] }), ctx).protected).toBe("starred");
    expect(classifyMessage(msg({ labelIds: ["INBOX", "CATEGORY_PROMOTIONS", "Label_12"] }), ctx).protected).toBe("has your own label");
  });

  it("categorises spam, promotions, social and newsletters", () => {
    expect(classifyMessage(msg({ labelIds: ["SPAM"] }), ctx).category).toBe("spam");
    expect(classifyMessage(msg({ labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] }), ctx).category).toBe("promotions");
    expect(classifyMessage(msg({ labelIds: ["INBOX", "CATEGORY_SOCIAL"] }), ctx).category).toBe("social");
    expect(classifyMessage(msg({ listUnsubscribe: "<https://x.example/u>" }), ctx).category).toBe("newsletter");
  });

  it("archives old bulk mail by default and trashes only when asked; never touches protected or recent mail", () => {
    const o = { archiveOlderThanDays: 30, trashOlderThanDays: null, now: NOW };
    const promo = msg({ labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] });
    expect(decideAction(promo, classifyMessage(promo, ctx), o)).toBe("archive");
    expect(decideAction(promo, classifyMessage(promo, ctx), { ...o, trashOlderThanDays: 45 })).toBe("trash");
    const recent = msg({ labelIds: ["INBOX", "CATEGORY_PROMOTIONS"], internalDate: daysAgo(3) });
    expect(decideAction(recent, classifyMessage(recent, ctx), o)).toBe("keep");
    const invoice = msg({ labelIds: ["INBOX", "CATEGORY_PROMOTIONS"], subject: "Invoice due" });
    expect(decideAction(invoice, classifyMessage(invoice, ctx), { ...o, trashOlderThanDays: 30 })).toBe("keep");
    for (const label of ["STARRED", "Label_7", "IMPORTANT"]) {
      const kept = msg({ labelIds: ["INBOX", label], listUnsubscribe: label === "IMPORTANT" ? undefined : "<https://x/u>" });
      expect(decideAction(kept, classifyMessage(kept, ctx), { ...o, trashOlderThanDays: 30 })).toBe("keep");
    }
    const newsletter = msg({ listUnsubscribe: "<https://x/u>" });
    expect(decideAction(newsletter, classifyMessage(newsletter, ctx), { ...o, trashOlderThanDays: 30 })).toBe("archive"); // newsletters never trashed
  });

  it("parses RFC 8058 one-click unsubscribe headers", () => {
    expect(parseUnsubscribe("<mailto:u@x.example>, <https://x.example/u?id=1>", "List-Unsubscribe=One-Click")).toEqual({ method: "one_click", url: "https://x.example/u?id=1", mailto: "mailto:u@x.example" });
    expect(parseUnsubscribe("<https://x.example/u>", undefined).method).toBe("link");
    expect(parseUnsubscribe("<mailto:u@x.example>", undefined).method).toBe("mailto");
    expect(parseUnsubscribe(undefined, undefined).method).toBe("none");
  });
});

describe("client identity matching", () => {
  const identities = [
    { clientId: "A", kind: "email", value: "nicole@acmerentals.com" },
    { clientId: "A", kind: "domain", value: "acmerentals.com" },
    { clientId: "B", kind: "phone", value: "+13135550101" },
  ];
  const clients = [
    { id: "A", name: "Nicole Smith", company: "Acme Rentals" },
    { id: "B", name: "Nathaniel Brown", company: null },
    { id: "C", name: "Nicole Smith", company: "Other Co" },
  ];

  it("normalises emails and phones", () => {
    expect(normalizeEmail("Nicole <NICOLE@AcmeRentals.com>")).toBe("nicole@acmerentals.com");
    expect(normalizeEmail("j.doe+work@googlemail.com")).toBe("j.doe@gmail.com");
    expect(normalizePhone("(313) 555-0101")).toBe("+13135550101");
    expect(normalizePhone("555-0101")).toBeNull();
    expect(isFreeMailDomain("Gmail.com")).toBe(true);
    expect(nameTokens("Acme Rentals LLC")).toEqual(["acme", "rentals"]);
  });

  it("auto-links only exact email/phone matches", () => {
    expect(matchObservation({ email: "NICOLE@acmerentals.com", source: "t" }, identities, clients)).toMatchObject({ clientId: "A", confidence: 1 });
    expect(matchObservation({ phone: "313-555-0101", source: "t" }, identities, clients)).toMatchObject({ clientId: "B", confidence: 0.95 });
  });

  it("sends domain and name matches for confirmation instead of guessing", () => {
    const r = matchObservation({ email: "accounts@acmerentals.com", source: "t" }, identities, clients);
    expect(r.clientId).toBeNull();
    expect(r.suggestions[0]).toMatchObject({ clientId: "A", confidence: 0.6 });
    const twoNicoles = matchObservation({ email: "nicole@gmail.com", name: "Nicole Smith", source: "t" }, identities, clients);
    expect(twoNicoles.clientId).toBeNull();
    expect(twoNicoles.conflict).toBe(true); // two clients share the name
  });

  it("never links when email and phone point to different clients", () => {
    const r = matchObservation({ email: "nicole@acmerentals.com", phone: "3135550101", source: "t" }, identities, clients);
    expect(r).toMatchObject({ clientId: null, conflict: true });
  });

  it("detects requests in client messages", () => {
    expect(looksLikeRequest("Can you clean unit 4 on Friday?", false)).toBe(true);
    expect(looksLikeRequest("Thanks, all good.", false)).toBe(false);
    expect(looksLikeRequest("Can you believe this sale?", true)).toBe(false); // bulk mail
  });

  it("validates automation policies narrowly", () => {
    expect(validateRules({ recipients: [], maxPerDay: 1 })).toMatch(/specific recipients/);
    expect(validateRules({ recipients: ["*@acme.com"], maxPerDay: 1 })).toMatch(/Wildcards/);
    expect(validateRules({ recipients: ["a@b.com"], maxPerDay: 100 })).toMatch(/maxPerDay/);
    expect(validateRules({ recipients: ["a@b.com"], maxPerDay: 3 })).toBeNull();
    expect(normalizeRecipient("(313) 555-0101")).toBe("+13135550101");
  });
});

describe("receptionist safety", () => {
  it("routes emergencies and requests for a person before any model call", () => {
    expect(preRoute("There's water flooding the kitchen")).toBe("urgent");
    expect(preRoute("Can I talk to a real person please")).toBe("human");
    expect(preRoute("I need a move-out clean next week")).toBeNull();
  });

  it("never lets prices, availability, bookings or terms through", () => {
    expect(guardReply("A deep clean is $250 for a two bedroom.").text).toBe(SAFE_PRICE);
    expect(guardReply("Our rate is about 40 an hour.").violations).toEqual(["price"]);
    expect(guardReply("Great, you're booked for Friday at 10.").text).toBe(SAFE_COMMIT);
    expect(guardReply("We're available tomorrow morning.").violations).toEqual(["commitment"]);
    expect(guardReply("We guarantee a spotless result.").violations).toEqual(["commitment"]);
    const terms = guardReply("The cancellation fee is waived within 24 hours.");
    expect(terms.violations).toHaveLength(1); // caught (as price or terms) — either way it is never spoken
    expect(terms.text).not.toMatch(/waived/);
    expect(guardReply("Our contract includes weekly visits.").violations).toEqual(["terms"]);
    const ok = guardReply("Thanks! What's the best number for the owner to call you back?");
    expect(ok).toEqual({ text: "Thanks! What's the best number for the owner to call you back?", violations: [] });
    const mixed = guardReply("Got it, a move-out clean. That costs 300 dollars. What's your name?");
    expect(mixed.text).toBe(`Got it, a move-out clean. ${SAFE_PRICE} What's your name?`);
  });

  it("parses the model's JSON turn and rejects malformed output", () => {
    expect(parseTurn('Sure: {"reply":"What is your name?","intent":"quote_request","done":false,"escalate":false,"captured":{"service":"move-out"}}')).toMatchObject({
      reply: "What is your name?",
      captured: { service: "move-out" },
    });
    expect(parseTurn("not json")).toBeNull();
    expect(parseTurn('{"reply":"x","intent":"made-up","done":false,"escalate":false}')).toBeNull();
  });

  it("computes Twilio signatures exactly like the official twilio library", () => {
    const token = "12345";
    const url = "https://mycompany.com/voice/gather?foo=1";
    const params = { CallSid: "CA1234567890ABCDE", From: "+12349013030", To: "+18005551212", SpeechResult: "I need a cleaning quote" };
    const official = twilio.getExpectedTwilioSignature(token, url, params);
    expect(twilioSignature(token, url, params)).toBe(official);
    expect(twilio.validateRequest(token, official, url, params)).toBe(true);
    expect(validTwilioRequest(token, url, params, official)).toBe(true);
    expect(validTwilioRequest(token, url, { ...params, From: "+19999999999" }, official)).toBe(false);
    expect(validTwilioRequest(token, url, params, undefined)).toBe(false);
  });

  it("escapes TwiML", () => {
    expect(xml(`<Dial>&"'`)).toBe("&lt;Dial&gt;&amp;&quot;&apos;");
    expect(gather("Hi <there>", "Polly.Joanna-Neural", "/voice/gather")).toContain("Hi &lt;there&gt;");
  });

  it("formats storage sizes", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
  });
});

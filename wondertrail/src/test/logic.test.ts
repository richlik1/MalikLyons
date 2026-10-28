import { describe, expect, it } from "vitest";
import { MISSIONS } from "../data/missions";
import { EMPTY_FILTERS, filterMissions, fitsAgeBand } from "../lib/missions";
import { validateReflection } from "../lib/progress";
import { initialState, reducer, type DemoState } from "../state/demoReducer";

const leoSubmitted = "att-seed-2";

function startAndSubmit(s: DemoState, childId: string, slug: string, text = "I learned a lot from this mission today."): DemoState {
  s = reducer(s, { type: "startMission", childId, slug });
  const a = s.attempts.find((x) => x.childId === childId && x.missionSlug === slug && x.status === "in_progress")!;
  return reducer(s, { type: "submitReflection", attemptId: a.id, reflection: text, feeling: null, parentAssisted: false });
}

describe("mission content", () => {
  it("has five complete, unique, published missions", () => {
    expect(MISSIONS).toHaveLength(5);
    expect(new Set(MISSIONS.map((m) => m.slug)).size).toBe(5);
    for (const m of MISSIONS) {
      expect(m.materials.length).toBeGreaterThan(0);
      expect(m.safetyNotes.length).toBeGreaterThan(0);
      expect(m.steps.length).toBeGreaterThan(0);
      expect(m.steps.length).toBeLessThanOrEqual(5);
      expect(m.reflectionQuestion).toMatch(/\?$/);
      expect(m.supervision.guidance.length).toBeGreaterThan(10);
      expect(m.ageMin).toBeGreaterThanOrEqual(7);
      expect(m.ageMax).toBeLessThanOrEqual(12);
    }
  });

  it("filters by category, age band, time, and query", () => {
    expect(filterMissions(MISSIONS, EMPTY_FILTERS)).toHaveLength(5);
    expect(filterMissions(MISSIONS, { ...EMPTY_FILTERS, categories: ["science"] }).map((m) => m.slug)).toEqual(["paper-bridge-lab"]);
    expect(filterMissions(MISSIONS, { ...EMPTY_FILTERS, ageBand: "9-10" })).toHaveLength(3);
    expect(filterMissions(MISSIONS, { ...EMPTY_FILTERS, maxMinutes: 15 }).map((m) => m.slug)).toEqual(["story-detective"]);
    expect(filterMissions(MISSIONS, { ...EMPTY_FILTERS, query: "coins" }).map((m) => m.slug)).toEqual(["paper-bridge-lab"]);
  });

  it("matches age bands", () => {
    const story = MISSIONS.find((m) => m.slug === "story-detective")!;
    expect(fitsAgeBand(story, "7-8")).toBe(true);
    expect(fitsAgeBand(story, "11-12")).toBe(false);
  });
});

describe("demo rules (mirror future server rules)", () => {
  it("rejects missions outside the child's age band", () => {
    const s = reducer(initialState(), { type: "startMission", childId: "child-maya", slug: "design-a-playground" });
    expect(s.lastError).toMatch(/isn.t recommended/i);
    expect(s.attempts.some((a) => a.childId === "child-maya")).toBe(false);
  });

  it("does not duplicate an attempt when started twice", () => {
    let s = reducer(initialState(), { type: "startMission", childId: "child-maya", slug: "story-detective" });
    s = reducer(s, { type: "startMission", childId: "child-maya", slug: "story-detective" });
    expect(s.attempts.filter((a) => a.childId === "child-maya")).toHaveLength(1);
  });

  it("requires a reflection", () => {
    let s = reducer(initialState(), { type: "startMission", childId: "child-maya", slug: "story-detective" });
    const id = s.attempts.at(-1)!.id;
    s = reducer(s, { type: "submitReflection", attemptId: id, reflection: "   ", feeling: null, parentAssisted: false });
    expect(s.lastError).toBeTruthy();
    expect(s.attempts.at(-1)!.status).toBe("in_progress");
    expect(validateReflection("short")).toMatch(/at least/);
  });

  it("blocks approval from child mode", () => {
    let s = reducer(initialState(), { type: "setMode", mode: "child" });
    s = reducer(s, { type: "review", attemptId: leoSubmitted, decision: "approved", note: "" });
    expect(s.lastError).toMatch(/grown-up/i);
    expect(s.attempts.find((a) => a.id === leoSubmitted)!.status).toBe("submitted");
  });

  it("approves once and awards achievements once", () => {
    let s = reducer(initialState(), { type: "review", attemptId: leoSubmitted, decision: "approved", note: "" });
    expect(s.attempts.find((a) => a.id === leoSubmitted)!.status).toBe("approved");
    const leo = () => s.achievements.filter((a) => a.childId === "child-leo").map((a) => a.achievementId);
    expect(leo()).toContain("curious-scientist");
    const count = leo().length;
    s = reducer(s, { type: "review", attemptId: leoSubmitted, decision: "approved", note: "" });
    expect(s.lastError).toMatch(/already been reviewed/);
    expect(leo()).toHaveLength(count);
    expect(new Set(leo()).size).toBe(count);
  });

  it("re-approving a repeated mission never duplicates badges", () => {
    let s = startAndSubmit(initialState(), "child-leo", "grocery-price-detective");
    const id = s.attempts.at(-1)!.id;
    const before = s.achievements.length;
    s = reducer(s, { type: "review", attemptId: id, decision: "approved", note: "" });
    expect(s.achievements).toHaveLength(before);
  });

  it("requires a note when returning for more learning, then allows resubmission", () => {
    let s = reducer(initialState(), { type: "review", attemptId: leoSubmitted, decision: "returned", note: " " });
    expect(s.lastError).toMatch(/note/);
    s = reducer(s, { type: "review", attemptId: leoSubmitted, decision: "returned", note: "Add what you'd test next." });
    expect(s.attempts.find((a) => a.id === leoSubmitted)!.status).toBe("returned");
    s = reducer(s, { type: "submitReflection", attemptId: leoSubmitted, reflection: "Next I'd test a paper tube bridge.", feeling: "curious", parentAssisted: false });
    expect(s.attempts.find((a) => a.id === leoSubmitted)!.status).toBe("submitted");
  });

  it("awards Trailblazer and Wide Explorer after three categories", () => {
    let s = reducer(initialState(), { type: "review", attemptId: leoSubmitted, decision: "approved", note: "" });
    s = startAndSubmit(s, "child-leo", "family-history-interview");
    s = reducer(s, { type: "review", attemptId: s.attempts.at(-1)!.id, decision: "approved", note: "Lovely" });
    const ids = s.achievements.filter((a) => a.childId === "child-leo").map((a) => a.achievementId);
    expect(ids).toEqual(expect.arrayContaining(["first-steps", "trailblazer", "explorer", "storykeeper"]));
  });

  it("deleting a child removes their attempts and badges", () => {
    const s = reducer(initialState(), { type: "deleteChild", childId: "child-leo" });
    expect(s.children.some((c) => c.id === "child-leo")).toBe(false);
    expect(s.attempts.some((a) => a.childId === "child-leo")).toBe(false);
    expect(s.achievements.some((a) => a.childId === "child-leo")).toBe(false);
    expect(s.activeChildId).not.toBe("child-leo");
  });

  it("rejects reviews for attempts not in the family", () => {
    const s = reducer(initialState(), { type: "review", attemptId: "att-other-family", decision: "approved", note: "" });
    expect(s.lastError).toMatch(/not in this family/);
  });
});

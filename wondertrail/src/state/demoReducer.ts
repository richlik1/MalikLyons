import { missionBySlug } from "../data/missions";
import { DEMO_CHILDREN } from "../data/profiles";
import type { ChildAchievement, ChildProfile, Feeling, MissionAttempt } from "../data/types";
import { fitsAgeBand } from "../lib/missions";
import { newlyEarned, validateReflection } from "../lib/progress";

// DEMO ONLY. This reducer runs in the browser and stores data in
// localStorage. It mirrors the rules the Phase 2 server functions must
// enforce, but it is NOT a security boundary.

export type Mode = "parent" | "child";

export interface DemoState {
  version: 1;
  mode: Mode;
  activeChildId: string | null;
  children: ChildProfile[];
  attempts: MissionAttempt[];
  achievements: ChildAchievement[];
  /** Last rule violation, surfaced to the UI. */
  lastError: string | null;
}

export type Action =
  | { type: "setMode"; mode: Mode }
  | { type: "setActiveChild"; childId: string }
  | { type: "startMission"; childId: string; slug: string; now?: string }
  | { type: "saveDraft"; attemptId: string; text: string }
  | { type: "submitReflection"; attemptId: string; reflection: string; feeling: Feeling | null; parentAssisted: boolean; now?: string }
  | { type: "review"; attemptId: string; decision: "approved" | "returned"; note: string; now?: string }
  | { type: "deleteChild"; childId: string }
  | { type: "clearError" }
  | { type: "reset" };

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}-${rand}`;
}

export function initialState(): DemoState {
  const attempts: MissionAttempt[] = [
    {
      id: "att-seed-1",
      childId: "child-leo",
      missionSlug: "grocery-price-detective",
      status: "approved",
      reflection: "The big cereal box was cheaper per gram but the big juice was not! I was surprised.",
      draftReflection: "",
      feeling: "curious",
      parentAssisted: false,
      startedAt: daysAgo(6),
      submittedAt: daysAgo(6),
      reviewedAt: daysAgo(5),
      history: [{ decision: "approved", note: "Great division work!", at: daysAgo(5) }],
    },
    {
      id: "att-seed-2",
      childId: "child-leo",
      missionSlug: "paper-bridge-lab",
      status: "submitted",
      reflection: "The zigzag bridge held 24 coins and the flat one held 3. Folds make it stiffer. Next I want to try a tube.",
      draftReflection: "",
      feeling: "proud",
      parentAssisted: false,
      startedAt: daysAgo(1),
      submittedAt: daysAgo(1),
      reviewedAt: null,
      history: [],
    },
    {
      id: "att-seed-3",
      childId: "child-ava",
      missionSlug: "design-a-playground",
      status: "in_progress",
      reflection: "",
      draftReflection: "",
      feeling: null,
      parentAssisted: false,
      startedAt: daysAgo(0),
      submittedAt: null,
      reviewedAt: null,
      history: [],
    },
  ];
  return {
    version: 1,
    mode: "parent",
    activeChildId: "child-leo",
    children: DEMO_CHILDREN,
    attempts,
    achievements: newlyEarned(attempts, [], "child-leo", daysAgo(5)),
    lastError: null,
  };
}

const fail = (state: DemoState, msg: string): DemoState => ({ ...state, lastError: msg });

function updateAttempt(state: DemoState, id: string, patch: Partial<MissionAttempt>): DemoState {
  return { ...state, lastError: null, attempts: state.attempts.map((a) => (a.id === id ? { ...a, ...patch } : a)) };
}

export function reducer(state: DemoState, action: Action): DemoState {
  switch (action.type) {
    case "setMode":
      return { ...state, mode: action.mode, lastError: null };

    case "setActiveChild":
      if (!state.children.some((c) => c.id === action.childId)) return fail(state, "That child profile is not in this family.");
      return { ...state, activeChildId: action.childId, lastError: null };

    case "startMission": {
      const child = state.children.find((c) => c.id === action.childId);
      const mission = missionBySlug(action.slug);
      if (!child) return fail(state, "That child profile is not in this family.");
      if (!mission || mission.status !== "published") return fail(state, "That mission isn't available.");
      if (!fitsAgeBand(mission, child.ageBand)) return fail(state, `This mission isn't recommended for ${child.displayName}'s age band.`);
      const open = state.attempts.find(
        (a) => a.childId === child.id && a.missionSlug === mission.slug && a.status !== "approved",
      );
      // Starting twice (double tap, refresh, repeated sync) must not create duplicates.
      if (open) return { ...state, lastError: null };
      const attempt: MissionAttempt = {
        id: newId("att"),
        childId: child.id,
        missionSlug: mission.slug,
        status: "in_progress",
        reflection: "",
        draftReflection: "",
        feeling: null,
        parentAssisted: false,
        startedAt: action.now ?? iso(new Date()),
        submittedAt: null,
        reviewedAt: null,
        history: [],
      };
      return { ...state, lastError: null, attempts: [...state.attempts, attempt] };
    }

    case "saveDraft": {
      const a = state.attempts.find((x) => x.id === action.attemptId);
      if (!a || (a.status !== "in_progress" && a.status !== "returned")) return state;
      return updateAttempt(state, a.id, { draftReflection: action.text.slice(0, 1000) });
    }

    case "submitReflection": {
      const a = state.attempts.find((x) => x.id === action.attemptId);
      if (!a) return fail(state, "We couldn't find that mission attempt.");
      if (a.status !== "in_progress" && a.status !== "returned") return fail(state, "This mission has already been sent for review.");
      const err = validateReflection(action.reflection);
      if (err) return fail(state, err);
      return updateAttempt(state, a.id, {
        status: "submitted",
        reflection: action.reflection.trim(),
        draftReflection: "",
        feeling: action.feeling,
        parentAssisted: action.parentAssisted,
        submittedAt: action.now ?? iso(new Date()),
      });
    }

    case "review": {
      if (state.mode !== "parent") return fail(state, "Only a grown-up can review missions.");
      const a = state.attempts.find((x) => x.id === action.attemptId);
      if (!a || !state.children.some((c) => c.id === a.childId)) return fail(state, "That attempt is not in this family.");
      if (a.status !== "submitted") return fail(state, "This attempt has already been reviewed.");
      if (action.decision === "returned" && action.note.trim().length === 0)
        return fail(state, "Add a short note so your child knows what to try next.");
      const now = action.now ?? iso(new Date());
      const reviewed = updateAttempt(state, a.id, {
        status: action.decision,
        reviewedAt: now,
        history: [...a.history, { decision: action.decision, note: action.note.trim(), at: now }],
      });
      if (action.decision !== "approved") return reviewed;
      const earned = newlyEarned(reviewed.attempts, reviewed.achievements, a.childId, now);
      return { ...reviewed, achievements: [...reviewed.achievements, ...earned] };
    }

    case "deleteChild": {
      const children = state.children.filter((c) => c.id !== action.childId);
      return {
        ...state,
        lastError: null,
        children,
        attempts: state.attempts.filter((a) => a.childId !== action.childId),
        achievements: state.achievements.filter((a) => a.childId !== action.childId),
        activeChildId: state.activeChildId === action.childId ? (children[0]?.id ?? null) : state.activeChildId,
      };
    }

    case "clearError":
      return { ...state, lastError: null };

    case "reset":
      return initialState();
  }
}

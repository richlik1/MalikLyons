import { ACHIEVEMENTS } from "../data/achievements";
import { missionBySlug } from "../data/missions";
import type { Achievement, ChildAchievement, MissionAttempt } from "../data/types";

export function approvedAttempts(attempts: MissionAttempt[], childId: string) {
  return attempts.filter((a) => a.childId === childId && a.status === "approved");
}

/** Distinct approved missions for a child (a mission counts once, however many times it was approved). */
export function approvedMissionSlugs(attempts: MissionAttempt[], childId: string): string[] {
  return [...new Set(approvedAttempts(attempts, childId).map((a) => a.missionSlug))];
}

export function qualifies(a: Achievement, attempts: MissionAttempt[], childId: string): boolean {
  const missions = approvedMissionSlugs(attempts, childId)
    .map((s) => missionBySlug(s))
    .filter((m) => m !== undefined);
  const c = a.criteria;
  switch (c.kind) {
    case "approved_count":
      return missions.length >= c.count;
    case "category":
      return missions.some((m) => m.category === c.category);
    case "distinct_categories":
      return new Set(missions.map((m) => m.category)).size >= c.count;
  }
}

/**
 * Returns the achievements newly earned by `childId`. Idempotent: any
 * achievement already present in `earned` is never awarded again.
 */
export function newlyEarned(
  attempts: MissionAttempt[],
  earned: ChildAchievement[],
  childId: string,
  now: string,
): ChildAchievement[] {
  const have = new Set(earned.filter((e) => e.childId === childId).map((e) => e.achievementId));
  return ACHIEVEMENTS.filter((a) => !have.has(a.id) && qualifies(a, attempts, childId)).map((a) => ({
    childId,
    achievementId: a.id,
    earnedAt: now,
  }));
}

export function skillsDemonstrated(attempts: MissionAttempt[], childId: string): string[] {
  const codes = approvedMissionSlugs(attempts, childId).flatMap((s) => missionBySlug(s)?.skills ?? []);
  return [...new Set(codes)];
}

/** The attempt a child is currently working on (or most recently worked on) for a mission. */
export function currentAttempt(attempts: MissionAttempt[], childId: string, slug: string) {
  const open = attempts.filter(
    (a) => a.childId === childId && a.missionSlug === slug && a.status !== "approved",
  );
  return open[open.length - 1];
}

export const REFLECTION_MIN = 10;
export const REFLECTION_MAX = 600;

export function validateReflection(text: string): string | null {
  const t = text.trim();
  if (t.length === 0) return "Please write or tell a grown-up your answer to the reflection question.";
  if (t.length < REFLECTION_MIN) return `Add a little more — at least ${REFLECTION_MIN} characters.`;
  if (t.length > REFLECTION_MAX) return `Keep it under ${REFLECTION_MAX} characters.`;
  return null;
}

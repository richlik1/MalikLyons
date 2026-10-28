// Structured content types. Shapes mirror the planned Phase 2 tables
// (missions, mission_steps, mission_skills, achievements) so the data can be
// migrated into Supabase without reshaping.

export type CategoryId = "reading" | "science" | "money" | "creativity" | "life" | "family";

export type AgeBand = "7-8" | "9-10" | "11-12";

export type SupervisionLevel = "independent" | "nearby" | "hands-on";

export type SkillCode = string;

export interface Category {
  id: CategoryId;
  name: string;
  shortName: string;
  description: string;
}

export interface Skill {
  code: SkillCode;
  label: string;
  category: CategoryId;
}

export interface Mission {
  id: string;
  slug: string;
  title: string;
  category: CategoryId;
  summary: string;
  objective: string;
  ageMin: number;
  ageMax: number;
  durationMinutes: number;
  materials: string[];
  supervision: { level: SupervisionLevel; guidance: string };
  safetyNotes: string[];
  steps: string[];
  reflectionQuestion: string;
  parentTip: string;
  skills: SkillCode[];
  status: "draft" | "published";
  version: number;
}

export interface ChildProfile {
  id: string;
  displayName: string;
  ageBand: AgeBand;
  avatar: AvatarId;
}

export type AvatarId = "fox" | "owl" | "turtle";

export interface Family {
  id: string;
  name: string;
  parentDisplayName: string;
}

export type AttemptStatus = "in_progress" | "submitted" | "returned" | "approved";

export type Feeling = "proud" | "curious" | "tricky" | "fun";

export interface ApprovalEvent {
  decision: "approved" | "returned";
  note: string;
  at: string;
}

export interface MissionAttempt {
  id: string;
  childId: string;
  missionSlug: string;
  status: AttemptStatus;
  reflection: string;
  draftReflection: string;
  feeling: Feeling | null;
  parentAssisted: boolean;
  startedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  history: ApprovalEvent[];
}

export type AchievementCriteria =
  | { kind: "approved_count"; count: number }
  | { kind: "category"; category: CategoryId }
  | { kind: "distinct_categories"; count: number };

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: "trail" | "star" | "compass" | "book" | "flask" | "coins" | "palette" | "home";
  criteria: AchievementCriteria;
}

export interface ChildAchievement {
  childId: string;
  achievementId: string;
  earnedAt: string;
}

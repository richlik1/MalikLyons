import type { Achievement } from "./types";

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-steps", title: "First Steps", description: "Complete your first approved mission.", icon: "trail", criteria: { kind: "approved_count", count: 1 } },
  { id: "trailblazer", title: "Trailblazer", description: "Complete three approved missions.", icon: "star", criteria: { kind: "approved_count", count: 3 } },
  { id: "explorer", title: "Wide Explorer", description: "Complete missions in three different categories.", icon: "compass", criteria: { kind: "distinct_categories", count: 3 } },
  { id: "word-wizard", title: "Word Wizard", description: "Complete a Reading & Communication mission.", icon: "book", criteria: { kind: "category", category: "reading" } },
  { id: "curious-scientist", title: "Curious Scientist", description: "Complete a Science & Nature mission.", icon: "flask", criteria: { kind: "category", category: "science" } },
  { id: "money-minded", title: "Money Minded", description: "Complete a Money & Math mission.", icon: "coins", criteria: { kind: "category", category: "money" } },
  { id: "big-imagination", title: "Big Imagination", description: "Complete a Creativity & Design mission.", icon: "palette", criteria: { kind: "category", category: "creativity" } },
  { id: "storykeeper", title: "Family Storykeeper", description: "Complete a Family & Community mission.", icon: "home", criteria: { kind: "category", category: "family" } },
];

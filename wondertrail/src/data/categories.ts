import type { AgeBand, Category, CategoryId, Skill, SupervisionLevel } from "./types";

export const CATEGORIES: Category[] = [
  { id: "reading", name: "Reading & Communication", shortName: "Reading", description: "Read closely, speak clearly, and share ideas." },
  { id: "science", name: "Science & Nature", shortName: "Science", description: "Predict, test, observe, and explain the world." },
  { id: "money", name: "Money & Math", shortName: "Money", description: "Count, compare, measure, and make smart choices." },
  { id: "creativity", name: "Creativity & Design", shortName: "Design", description: "Imagine, plan, build, and improve." },
  { id: "life", name: "Life Skills", shortName: "Life Skills", description: "Everyday skills that build independence." },
  { id: "family", name: "Family & Community", shortName: "Family", description: "Connect with the people around you." },
];

export const categoryById = (id: CategoryId): Category =>
  CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];

export const AGE_BANDS: { id: AgeBand; label: string; min: number; max: number }[] = [
  { id: "7-8", label: "Ages 7–8", min: 7, max: 8 },
  { id: "9-10", label: "Ages 9–10", min: 9, max: 10 },
  { id: "11-12", label: "Ages 11–12", min: 11, max: 12 },
];

export const ageBandRange = (band: AgeBand) => AGE_BANDS.find((b) => b.id === band)!;

export const SUPERVISION_LABELS: Record<SupervisionLevel, { label: string; childLabel: string }> = {
  independent: { label: "Independent — check in at the end", childLabel: "You can do this on your own" },
  nearby: { label: "Adult nearby", childLabel: "Have a grown-up nearby" },
  "hands-on": { label: "Adult hands-on", childLabel: "Do this together with a grown-up" },
};

export const SKILLS: Skill[] = [
  { code: "inference", label: "Finding clues in a text", category: "reading" },
  { code: "emotional-vocabulary", label: "Naming feelings", category: "reading" },
  { code: "explaining", label: "Explaining my thinking", category: "reading" },
  { code: "predicting", label: "Making predictions", category: "science" },
  { code: "fair-testing", label: "Running a fair test", category: "science" },
  { code: "recording-data", label: "Recording results", category: "science" },
  { code: "unit-price", label: "Comparing unit prices", category: "money" },
  { code: "division", label: "Using division", category: "money" },
  { code: "value-judgement", label: "Weighing value", category: "money" },
  { code: "scale-drawing", label: "Drawing to scale", category: "creativity" },
  { code: "inclusive-design", label: "Designing for everyone", category: "creativity" },
  { code: "presenting", label: "Presenting an idea", category: "creativity" },
  { code: "interviewing", label: "Asking good questions", category: "family" },
  { code: "active-listening", label: "Listening carefully", category: "family" },
  { code: "summarizing", label: "Summarizing", category: "family" },
];

export const skillByCode = (code: string) => SKILLS.find((s) => s.code === code);

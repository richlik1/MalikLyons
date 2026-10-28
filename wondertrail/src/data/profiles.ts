import type { ChildProfile, Family } from "./types";

// FICTIONAL demo data only. Phase 1 never collects real child information.
// Only a display name and age band are modelled — no birthdates, schools,
// photos, or locations.

export const DEMO_FAMILY: Family = {
  id: "fam-demo",
  name: "The Demo Family",
  parentDisplayName: "Sam (demo parent)",
};

export const DEMO_CHILDREN: ChildProfile[] = [
  { id: "child-maya", displayName: "Maya", ageBand: "7-8", avatar: "owl" },
  { id: "child-leo", displayName: "Leo", ageBand: "9-10", avatar: "fox" },
  { id: "child-ava", displayName: "Ava", ageBand: "11-12", avatar: "turtle" },
];

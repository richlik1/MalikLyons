import { ageBandRange } from "../data/categories";
import type { AgeBand, CategoryId, Mission } from "../data/types";

export interface MissionFilters {
  categories: CategoryId[];
  ageBand: AgeBand | "all";
  maxMinutes: number | "all";
  query: string;
}

export const EMPTY_FILTERS: MissionFilters = { categories: [], ageBand: "all", maxMinutes: "all", query: "" };

export function fitsAgeBand(mission: Mission, band: AgeBand): boolean {
  const { min, max } = ageBandRange(band);
  return mission.ageMin <= max && mission.ageMax >= min;
}

export function filterMissions(missions: Mission[], f: MissionFilters): Mission[] {
  const q = f.query.trim().toLowerCase();
  return missions.filter(
    (m) =>
      m.status === "published" &&
      (f.categories.length === 0 || f.categories.includes(m.category)) &&
      (f.ageBand === "all" || fitsAgeBand(m, f.ageBand)) &&
      (f.maxMinutes === "all" || m.durationMinutes <= f.maxMinutes) &&
      (q === "" ||
        m.title.toLowerCase().includes(q) ||
        m.summary.toLowerCase().includes(q) ||
        m.materials.some((x) => x.toLowerCase().includes(q))),
  );
}

export const formatAges = (m: Mission) => `Ages ${m.ageMin}–${m.ageMax}`;
export const formatMinutes = (n: number) => `${n} min`;

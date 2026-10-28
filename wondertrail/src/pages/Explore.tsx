import { Search } from "lucide-react";
import { useState } from "react";
import { AgeBandSelector } from "../components/AgeBandSelector";
import { CategoryFilter } from "../components/CategoryFilter";
import { MissionCard } from "../components/MissionCard";
import { EmptyState, PageHeader } from "../components/ui";
import { MISSIONS } from "../data/missions";
import { EMPTY_FILTERS, filterMissions, fitsAgeBand, type MissionFilters } from "../lib/missions";
import { currentAttempt, approvedMissionSlugs } from "../lib/progress";
import { useActiveChild, useDemo } from "../state/DemoStore";

const TIMES: { v: MissionFilters["maxMinutes"]; label: string }[] = [
  { v: "all", label: "Any time" },
  { v: 15, label: "15 min or less" },
  { v: 30, label: "30 min or less" },
  { v: 45, label: "45 min or less" },
];

export default function Explore() {
  const { state } = useDemo();
  const child = useActiveChild();
  const isChild = state.mode === "child";
  const [f, setF] = useState<MissionFilters>(() => ({ ...EMPTY_FILTERS, ageBand: isChild && child ? child.ageBand : "all" }));
  const results = filterMissions(MISSIONS, f);
  const set = (patch: Partial<MissionFilters>) => setF((prev) => ({ ...prev, ...patch }));

  return (
    <div className="page">
      <PageHeader eyebrow="Explore" title={isChild ? "Find your next mission" : "Mission explorer"}>
        {isChild ? "Pick something that sounds fun, then show a grown-up." : "Browse by skill, age, and time. This demo includes 5 of the 30 planned missions."}
      </PageHeader>

      <div className="card mb-6 flex flex-col gap-5 p-5">
        <div>
          <label htmlFor="q" className="field-label">Search</label>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" />
            <input id="q" type="search" className="input pl-12" placeholder="Try “paper” or “interview”" value={f.query} onChange={(e) => set({ query: e.target.value })} />
          </div>
        </div>
        <CategoryFilter selected={f.categories} onChange={(categories) => set({ categories })} />
        <div className="flex flex-col gap-5 lg:flex-row">
          <AgeBandSelector value={f.ageBand} onChange={(ageBand) => set({ ageBand })} />
          <fieldset>
            <legend className="field-label">Time</legend>
            <div className="flex flex-wrap gap-2">
              {TIMES.map((t) => (
                <button
                  key={String(t.v)}
                  type="button"
                  aria-pressed={f.maxMinutes === t.v}
                  onClick={() => set({ maxMinutes: t.v })}
                  className={`chip min-h-[44px] border-2 px-4 ${f.maxMinutes === t.v ? "border-primary bg-primary-light text-primary-dark" : "border-cream-300 bg-white text-ink-muted"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <p aria-live="polite" className="font-bold">{results.length} {results.length === 1 ? "mission" : "missions"}</p>
        <button type="button" className="btn-ghost min-h-[44px] px-3 text-sm" onClick={() => setF(EMPTY_FILTERS)}>Clear filters</button>
      </div>

      {results.length === 0 ? (
        <EmptyState title="No missions match" action={<button type="button" className="btn-secondary" onClick={() => setF(EMPTY_FILTERS)}>Clear filters</button>}>
          Try a different age band or category.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((m) => {
            const done = child && approvedMissionSlugs(state.attempts, child.id).includes(m.slug);
            const open = child && currentAttempt(state.attempts, child.id, m.slug);
            const outOfBand = child && !fitsAgeBand(m, child.ageBand);
            return (
              <li key={m.id}>
                <MissionCard
                  mission={m}
                  childFriendly={isChild}
                  status={open ? open.status : done ? "approved" : undefined}
                  warning={outOfBand ? `Not for ${child.displayName}'s age band` : undefined}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

import { SUPERVISION_LABELS, categoryById, skillByCode } from "../data/categories";
import type { Mission } from "../data/types";
import { formatAges, formatMinutes } from "../lib/missions";
import { CategoryTile } from "./ui";

/** Offline activity card, laid out for a single printed page. */
export function PrintableMissionCard({ mission }: { mission: Mission }) {
  return (
    <article className="print-area card mx-auto max-w-3xl p-6 sm:p-8" aria-label={`Printable card: ${mission.title}`}>
      <header className="flex items-center gap-4 border-b-2 border-dashed border-cream-300 pb-4">
        <CategoryTile id={mission.category} />
        <div className="flex-1">
          <p className="eyebrow">{categoryById(mission.category).name}</p>
          <h1 className="text-3xl">{mission.title}</h1>
          <p className="font-semibold text-ink-muted">
            {formatAges(mission)} · {formatMinutes(mission.durationMinutes)} · {SUPERVISION_LABELS[mission.supervision.level].label}
          </p>
        </div>
      </header>

      <p className="mt-4 text-lg"><span className="font-bold">Mission:</span> {mission.objective}</p>

      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <section>
          <h2 className="mb-2 text-lg">Pack your kit</h2>
          <ul className="space-y-1">
            {mission.materials.map((m) => <li key={m}>☐ {m}</li>)}
          </ul>
        </section>
        <section className="rounded-2xl border-2 border-coral-dark/60 p-3">
          <h2 className="mb-2 text-lg">⚠ Stay safe</h2>
          <ul className="list-disc space-y-1 pl-5">
            {mission.safetyNotes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </section>
      </div>

      <section className="mt-6">
        <h2 className="mb-2 text-lg">Trail steps</h2>
        <ol className="space-y-2">
          {mission.steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="shrink-0 whitespace-nowrap font-extrabold">☐ {i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-6 rounded-2xl bg-sun-light p-4">
        <h2 className="text-lg">Think about it</h2>
        <p className="font-semibold">{mission.reflectionQuestion}</p>
        <div className="mt-3 space-y-6" aria-hidden>
          <div className="border-b border-ink/30" />
          <div className="border-b border-ink/30" />
          <div className="border-b border-ink/30" />
        </div>
      </section>

      <footer className="mt-6 flex flex-wrap justify-between gap-2 text-sm text-ink-muted">
        <span>Skills: {mission.skills.map((s) => skillByCode(s)?.label ?? s).join(" · ")}</span>
        <span>Grown-up check: ____________</span>
      </footer>
      <p className="mt-2 text-xs text-ink-muted">WonderTrail (working name) · Demo prototype · LYONS Technologies</p>
    </article>
  );
}

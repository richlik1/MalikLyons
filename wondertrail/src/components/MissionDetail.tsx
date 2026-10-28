import { Backpack, Clock, Lightbulb, MessageCircleQuestion, ShieldCheck, Target, Users } from "lucide-react";
import type { ReactNode } from "react";
import { SUPERVISION_LABELS, skillByCode } from "../data/categories";
import type { Mission } from "../data/types";
import { formatAges, formatMinutes } from "../lib/missions";
import { CategoryBadge, CategoryTile } from "./ui";

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="mb-3 flex items-center gap-2 text-xl">
        <span aria-hidden className="text-primary">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Full mission content. `audience` switches wording for the child view; content stays identical. */
export function MissionDetail({ mission, audience, actions }: { mission: Mission; audience: "parent" | "child"; actions?: ReactNode }) {
  const sup = SUPERVISION_LABELS[mission.supervision.level];
  const kid = audience === "child";
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_340px]">
      {/* On mobile the actions and safety notes sit right under the title, before the steps. */}
      <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
        <CategoryTile id={mission.category} size="lg" />
        <div>
          <CategoryBadge id={mission.category} />
          <h1 className="mt-2 text-3xl sm:text-4xl">{mission.title}</h1>
          <p className="mt-1 text-lg text-ink-muted">{mission.summary}</p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-semibold text-ink-muted">
            <li className="flex items-center gap-1.5"><Clock aria-hidden className="h-5 w-5" /> {formatMinutes(mission.durationMinutes)}</li>
            <li className="flex items-center gap-1.5"><Users aria-hidden className="h-5 w-5" /> {formatAges(mission)}</li>
          </ul>
        </div>
      </div>

      <aside className="flex flex-col gap-5 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        {actions}
        <section className="card border-2 border-coral/40 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-xl">
            <ShieldCheck aria-hidden className="h-6 w-6 text-coral-dark" /> {kid ? "Stay safe" : "Safety notes"}
          </h2>
          <p className="chip mb-3 bg-coral-light text-coral-dark">{kid ? sup.childLabel : sup.label}</p>
          <ul className="list-disc space-y-1.5 pl-6 marker:text-coral-dark">
            {mission.safetyNotes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </section>
        {!kid && (
          <section className="card p-5">
            <h2 className="mb-2 text-xl">Grown-up guidance</h2>
            <p className="text-ink-muted">{mission.supervision.guidance}</p>
            <h3 className="mb-1 mt-4 text-base font-bold">Tip</h3>
            <p className="text-ink-muted">{mission.parentTip}</p>
          </section>
        )}
      </aside>

      <div className="flex flex-col gap-5 lg:col-start-1">
        <Section icon={<Target className="h-6 w-6" />} title={kid ? "Your mission" : "Learning objective"}>
          <p className="text-lg">{mission.objective}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {mission.skills.map((s) => (
              <span key={s} className="chip bg-primary-light text-primary-dark">{skillByCode(s)?.label ?? s}</span>
            ))}
          </div>
        </Section>

        <Section icon={<Backpack className="h-6 w-6" />} title={kid ? "Pack your kit" : "Materials"}>
          <ul className="list-disc space-y-1.5 pl-6 marker:text-coral">
            {mission.materials.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </Section>

        <Section icon={<Lightbulb className="h-6 w-6" />} title={kid ? "Trail steps" : "Steps"}>
          <ol className="space-y-3">
            {mission.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-lg font-extrabold text-white">{i + 1}</span>
                <span className="pt-1"><span className="sr-only">Step {i + 1}: </span>{s}</span>
              </li>
            ))}
          </ol>
        </Section>

        <Section icon={<MessageCircleQuestion className="h-6 w-6" />} title="Think about it">
          <p className="rounded-2xl bg-sun-light p-4 text-lg font-semibold">{mission.reflectionQuestion}</p>
        </Section>
      </div>

    </div>
  );
}

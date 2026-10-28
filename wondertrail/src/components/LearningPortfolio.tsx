import { ACHIEVEMENTS } from "../data/achievements";
import { CATEGORIES, skillByCode } from "../data/categories";
import { missionBySlug } from "../data/missions";
import type { ChildAchievement, ChildProfile, MissionAttempt } from "../data/types";
import { approvedAttempts, skillsDemonstrated } from "../lib/progress";
import { AchievementBadge } from "./AchievementBadge";
import { CategoryBadge, CategoryTile, EmptyState } from "./ui";

interface Props {
  child: ChildProfile;
  attempts: MissionAttempt[];
  achievements: ChildAchievement[];
  audience: "parent" | "child";
}

/** Celebrates demonstrated, parent-approved skills — never screen time. */
export function LearningPortfolio({ child, attempts, achievements, audience }: Props) {
  const approved = approvedAttempts(attempts, child.id).sort((a, b) => (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? ""));
  const skills = skillsDemonstrated(attempts, child.id);
  const earned = new Map(achievements.filter((a) => a.childId === child.id).map((a) => [a.achievementId, a.earnedAt]));
  const byCategory = CATEGORIES.map((c) => ({
    c,
    n: approved.filter((a) => missionBySlug(a.missionSlug)?.category === c.id).length,
  }));

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="pf-stats" className="grid grid-cols-3 gap-3">
        <h2 id="pf-stats" className="sr-only">Summary</h2>
        {[
          { n: new Set(approved.map((a) => a.missionSlug)).size, label: "Missions completed" },
          { n: skills.length, label: "Skills shown" },
          { n: earned.size, label: "Badges earned" },
        ].map((s) => (
          <div key={s.label} className="card p-4 text-center">
            <p className="text-3xl font-extrabold text-primary sm:text-4xl">{s.n}</p>
            <p className="text-sm font-semibold text-ink-muted">{s.label}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="pf-badges">
        <h2 id="pf-badges" className="mb-3 text-2xl">Badges</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ACHIEVEMENTS.map((a) => (
            <AchievementBadge key={a.id} achievement={a} earned={earned.has(a.id)} earnedAt={earned.get(a.id)} />
          ))}
        </div>
      </section>

      <section aria-labelledby="pf-skills">
        <h2 id="pf-skills" className="mb-3 text-2xl">Skills {audience === "child" ? "you've" : `${child.displayName} has`} shown</h2>
        {skills.length === 0 ? (
          <p className="text-ink-muted">Skills appear here after a grown-up approves a mission.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {skills.map((s) => (
              <li key={s} className="chip bg-primary-light px-4 py-2 text-base text-primary-dark">✓ {skillByCode(s)?.label ?? s}</li>
            ))}
          </ul>
        )}
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Missions completed by category">
          {byCategory.map(({ c, n }) => (
            <li key={c.id} className="flex items-center justify-between gap-2 rounded-2xl bg-white p-3">
              <CategoryBadge id={c.id} short />
              <span className="font-extrabold">{n}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="pf-missions">
        <h2 id="pf-missions" className="mb-3 text-2xl">Completed missions</h2>
        {approved.length === 0 ? (
          <EmptyState title="Your trail starts here">Finish a mission and a grown-up's approval adds it to this portfolio.</EmptyState>
        ) : (
          <ol className="flex flex-col gap-3">
            {approved.map((a) => {
              const m = missionBySlug(a.missionSlug);
              if (!m) return null;
              return (
                <li key={a.id} className="card flex flex-col gap-3 p-5 sm:flex-row">
                  <CategoryTile id={m.category} />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xl">{m.title}</h3>
                    <p className="text-sm text-ink-muted">Approved {a.reviewedAt ? new Date(a.reviewedAt).toLocaleDateString() : ""}</p>
                    <p className="mt-2 whitespace-pre-wrap break-words">“{a.reflection}”</p>
                    {a.history.at(-1)?.note && (
                      <p className="mt-2 text-sm text-primary-dark"><span className="font-bold">Grown-up note:</span> {a.history.at(-1)!.note}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

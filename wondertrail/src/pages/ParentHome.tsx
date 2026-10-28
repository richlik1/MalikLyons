import { ArrowRight, ClipboardCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { ChildProfileCard } from "../components/ChildProfileCard";
import { MissionCard } from "../components/MissionCard";
import { EmptyState, PageHeader, StatusPill } from "../components/ui";
import { MISSIONS, missionBySlug } from "../data/missions";
import { DEMO_FAMILY } from "../data/profiles";
import { fitsAgeBand } from "../lib/missions";
import { approvedMissionSlugs } from "../lib/progress";
import { useActiveChild, useDemo } from "../state/DemoStore";

export default function ParentHome() {
  const { state, dispatch } = useDemo();
  const child = useActiveChild();
  const pending = state.attempts.filter((a) => a.status === "submitted");

  const childAttempts = child ? state.attempts.filter((a) => a.childId === child.id) : [];
  const active = childAttempts.filter((a) => a.status !== "approved");
  const done = child ? approvedMissionSlugs(state.attempts, child.id) : [];
  const recommended = child
    ? MISSIONS.filter((m) => fitsAgeBand(m, child.ageBand) && !done.includes(m.slug) && !active.some((a) => a.missionSlug === m.slug))
    : [];

  return (
    <div className="page">
      <PageHeader eyebrow={DEMO_FAMILY.name} title={`Welcome back, ${DEMO_FAMILY.parentDisplayName.split(" ")[0]}`}>
        Guide today's adventures and celebrate what your children have learned.
      </PageHeader>

      {pending.length > 0 && (
        <Link to="/parent/reviews" className="card mb-6 flex items-center gap-4 border-2 border-primary/40 bg-primary-light/50 p-4 hover:border-primary">
          <ClipboardCheck aria-hidden className="h-8 w-8 shrink-0 text-primary" />
          <span className="flex-1 text-lg font-bold">
            {pending.length} {pending.length === 1 ? "mission is" : "missions are"} waiting for your review
          </span>
          <ArrowRight aria-hidden className="h-6 w-6 text-primary" />
        </Link>
      )}

      <section aria-labelledby="children-h" className="mb-8">
        <h2 id="children-h" className="mb-3 text-2xl">Your explorers</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {state.children.map((c) => (
            <ChildProfileCard
              key={c.id}
              child={c}
              selected={c.id === child?.id}
              completed={approvedMissionSlugs(state.attempts, c.id).length}
              pending={pending.filter((a) => a.childId === c.id).length}
              onSelect={() => dispatch({ type: "setActiveChild", childId: c.id })}
            />
          ))}
        </div>
        {state.children.length === 0 && (
          <EmptyState title="No child profiles" action={<Link className="btn-primary" to="/settings">Family settings</Link>}>
            Restore the sample family in settings to continue the demo.
          </EmptyState>
        )}
      </section>

      {child && (
        <>
          <section aria-labelledby="active-h" className="mb-8">
            <h2 id="active-h" className="mb-3 text-2xl">{child.displayName}'s missions in progress</h2>
            {active.length === 0 ? (
              <p className="text-ink-muted">Nothing in progress. Pick a recommended mission below.</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {active.map((a) => {
                  const m = missionBySlug(a.missionSlug);
                  if (!m) return null;
                  return (
                    <li key={a.id} className="card flex items-center justify-between gap-3 p-4">
                      <Link to={`/missions/${m.slug}`} className="text-lg font-bold hover:underline">{m.title}</Link>
                      <StatusPill status={a.status} />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="rec-h">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <h2 id="rec-h" className="text-2xl">Recommended for {child.displayName}</h2>
              <Link to="/explore" className="font-bold text-primary hover:underline">Explore all missions →</Link>
            </div>
            {recommended.length === 0 ? (
              <p className="text-ink-muted">
                {child.displayName} has tried every demo mission for their age band. 25 more missions arrive with the full curriculum.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {recommended.map((m) => <MissionCard key={m.id} mission={m} />)}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

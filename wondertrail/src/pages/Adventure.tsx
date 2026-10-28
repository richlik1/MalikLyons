import { Link } from "react-router-dom";
import { MissionCard } from "../components/MissionCard";
import { Avatar, EmptyState, Notice, StatusPill } from "../components/ui";
import { ACHIEVEMENTS } from "../data/achievements";
import { MISSIONS, missionBySlug } from "../data/missions";
import { fitsAgeBand } from "../lib/missions";
import { approvedMissionSlugs, currentAttempt } from "../lib/progress";
import { useActiveChild, useDemo } from "../state/DemoStore";

/** Child home. Contains no external links, ads, or chat. */
export default function Adventure() {
  const { state } = useDemo();
  const child = useActiveChild();

  if (!child) {
    return (
      <div className="page">
        <EmptyState title="No explorer selected">Ask a grown-up to pick your profile.</EmptyState>
      </div>
    );
  }

  const mine = state.attempts.filter((a) => a.childId === child.id);
  const onTrail = mine.filter((a) => a.status === "in_progress" || a.status === "returned");
  const waiting = mine.filter((a) => a.status === "submitted");
  const done = approvedMissionSlugs(state.attempts, child.id);
  const choices = MISSIONS.filter((m) => m.status === "published" && fitsAgeBand(m, child.ageBand));
  const badges = state.achievements.filter((a) => a.childId === child.id).length;

  return (
    <div className="page">
      {state.mode === "parent" && (
        <div className="mb-5">
          <Notice>You're previewing {child.displayName}'s adventure screen. Use “Child mode” to hand over the device.</Notice>
        </div>
      )}

      <section className="card mb-8 flex flex-col items-center gap-4 bg-primary p-6 text-center text-white sm:flex-row sm:text-left">
        <Avatar id={child.avatar} size={88} />
        <div className="flex-1">
          <h1 className="text-3xl text-white sm:text-4xl">Hi {child.displayName}! Ready to explore?</h1>
          <p className="mt-1 text-lg text-primary-light">Pick a mission, head offline, then come back and tell us what you learned.</p>
        </div>
        <Link to="/portfolio" className="btn bg-sun text-ink hover:bg-[#E8A82A]">
          <span aria-hidden>🏅</span> {badges} of {ACHIEVEMENTS.length} badges
        </Link>
      </section>

      {onTrail.length > 0 && (
        <section aria-labelledby="trail-h" className="mb-8">
          <h2 id="trail-h" className="mb-3 text-2xl">On your trail</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {onTrail.map((a) => {
              const m = missionBySlug(a.missionSlug);
              if (!m) return null;
              return (
                <li key={a.id} className="card flex flex-col gap-3 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xl">{m.title}</h3>
                    <StatusPill status={a.status} child />
                  </div>
                  {a.status === "returned" && a.history.at(-1)?.note && (
                    <p className="rounded-2xl bg-coral-light p-3"><span className="font-bold">Grown-up says:</span> {a.history.at(-1)!.note}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Link to={`/missions/${m.slug}`} className="btn-secondary flex-1">See steps</Link>
                    <Link to={`/missions/${m.slug}/submit`} className="btn-coral flex-1">I finished!</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {waiting.length > 0 && (
        <section aria-labelledby="wait-h" className="mb-8">
          <h2 id="wait-h" className="mb-3 text-2xl">Waiting for a grown-up</h2>
          <ul className="flex flex-wrap gap-2">
            {waiting.map((a) => (
              <li key={a.id} className="card flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="font-bold">{missionBySlug(a.missionSlug)?.title}</span>
                <StatusPill status={a.status} child />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="choose-h">
        <h2 id="choose-h" className="mb-3 text-2xl">Choose a mission</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {choices.map((m) => {
            const open = currentAttempt(state.attempts, child.id, m.slug);
            return (
              <li key={m.id}>
                <MissionCard mission={m} childFriendly status={open?.status ?? (done.includes(m.slug) ? "approved" : undefined)} />
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-ink-muted">More missions for your age are coming soon!</p>
      </section>
    </div>
  );
}

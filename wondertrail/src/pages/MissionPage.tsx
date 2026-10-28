import { ArrowLeft, Flag, PencilLine, Printer } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MissionDetail } from "../components/MissionDetail";
import { Notice, StatusPill } from "../components/ui";
import { ageBandRange } from "../data/categories";
import { missionBySlug } from "../data/missions";
import type { Mission } from "../data/types";
import { fitsAgeBand } from "../lib/missions";
import { approvedMissionSlugs, currentAttempt } from "../lib/progress";
import { useActiveChild, useDemo } from "../state/DemoStore";
import NotFound from "./NotFound";

function MissionActions({ mission }: { mission: Mission }) {
  const { state, dispatch } = useDemo();
  const child = useActiveChild();
  const navigate = useNavigate();
  const isChild = state.mode === "child";
  const attempt = child ? currentAttempt(state.attempts, child.id, mission.slug) : undefined;
  const done = child ? approvedMissionSlugs(state.attempts, child.id).includes(mission.slug) : false;
  const fits = child ? fitsAgeBand(mission, child.ageBand) : false;
  const lastNote = attempt?.history.at(-1);

  return (
    <section className="no-print card flex flex-col gap-4 p-5" aria-label="Mission actions">
      {!isChild && (
        <div>
          <label htmlFor="child-select" className="field-label">Who is doing this mission?</label>
          <select
            id="child-select"
            className="input"
            value={child?.id ?? ""}
            onChange={(e) => dispatch({ type: "setActiveChild", childId: e.target.value })}
          >
            {state.children.map((c) => (
              <option key={c.id} value={c.id}>{c.displayName} ({ageBandRange(c.ageBand).label})</option>
            ))}
          </select>
        </div>
      )}

      {child && attempt && <StatusPill status={attempt.status} child={isChild} />}
      {child && !attempt && done && <StatusPill status="approved" child={isChild} />}

      {child && !fits && (
        <Notice tone="warn" title="Not recommended">
          This mission is designed for ages {mission.ageMin}–{mission.ageMax}, so it can't be started for {child.displayName}{" "}
          ({ageBandRange(child.ageBand).label}).
        </Notice>
      )}

      {child && fits && !attempt && (
        <button type="button" className="btn-primary w-full text-lg" onClick={() => dispatch({ type: "startMission", childId: child.id, slug: mission.slug })}>
          <Flag aria-hidden className="h-5 w-5" /> {done ? "Do it again" : isChild ? "Start my mission" : `Start for ${child.displayName}`}
        </button>
      )}

      {attempt?.status === "in_progress" && (
        <>
          <div className="rounded-2xl bg-[#DDF1E4] p-4 text-[#1D5E35]">
            <p className="text-lg font-extrabold">Time to head offline! 🌳</p>
            <p>Put the screen down and follow the steps. Come back when you've finished.</p>
          </div>
          <button type="button" className="btn-coral w-full text-lg" onClick={() => navigate(`/missions/${mission.slug}/submit`)}>
            <PencilLine aria-hidden className="h-5 w-5" /> I finished — reflect
          </button>
        </>
      )}

      {attempt?.status === "returned" && (
        <>
          {lastNote && <Notice title="A note from your grown-up">{lastNote.note}</Notice>}
          <button type="button" className="btn-coral w-full text-lg" onClick={() => navigate(`/missions/${mission.slug}/submit`)}>
            <PencilLine aria-hidden className="h-5 w-5" /> Add to my reflection
          </button>
        </>
      )}

      {attempt?.status === "submitted" && (
        <p className="text-ink-muted">
          {isChild ? "Nice work! A grown-up will look at your reflection soon." : <>Reflection sent. <Link className="font-bold text-primary underline" to="/parent/reviews">Review it now</Link>.</>}
        </p>
      )}

      <Link to={`/missions/${mission.slug}/print`} className="btn-secondary w-full">
        <Printer aria-hidden className="h-5 w-5" /> Print activity card
      </Link>
    </section>
  );
}

export default function MissionPage() {
  const { slug } = useParams();
  const { state } = useDemo();
  const navigate = useNavigate();
  const mission = missionBySlug(slug);
  if (!mission) return <NotFound />;
  return (
    <div className="page">
      <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/explore"))} className="no-print btn-ghost mb-3 -ml-3 min-h-[44px] px-3">
        <ArrowLeft aria-hidden className="h-5 w-5" /> Back
      </button>
      <MissionDetail mission={mission} audience={state.mode} actions={<MissionActions mission={mission} />} />
    </div>
  );
}

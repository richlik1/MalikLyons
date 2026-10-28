import { ArrowLeft, Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { FEELINGS } from "../components/ParentApprovalCard";
import { EmptyState, Notice, PageHeader } from "../components/ui";
import { missionBySlug } from "../data/missions";
import type { Feeling } from "../data/types";
import { REFLECTION_MAX, currentAttempt, validateReflection } from "../lib/progress";
import { useActiveChild, useDemo } from "../state/DemoStore";
import NotFound from "./NotFound";

export default function Submit() {
  const { slug } = useParams();
  const { state, dispatch } = useDemo();
  const child = useActiveChild();
  const mission = missionBySlug(slug);
  const attempt = mission && child ? currentAttempt(state.attempts, child.id, mission.slug) : undefined;
  const [text, setText] = useState(() => attempt?.draftReflection || (attempt?.status === "returned" ? attempt.reflection : ""));
  const [feeling, setFeeling] = useState<Feeling | null>(attempt?.feeling ?? null);
  const [assisted, setAssisted] = useState(attempt?.parentAssisted ?? state.mode === "parent");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const isChild = state.mode === "child";

  if (!mission) return <NotFound />;

  if (sent) {
    return (
      <div className="page">
        <div className="card mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center" role="status">
          <span aria-hidden className="text-6xl">🎒✨</span>
          <h1 className="text-3xl">Reflection sent!</h1>
          <p className="text-lg text-ink-muted">A grown-up will review {mission.title}. When they approve it, it joins the portfolio.</p>
          <div className="flex flex-wrap justify-center gap-2">
            {isChild ? (
              <Link to="/adventure" className="btn-primary">Back to my adventure</Link>
            ) : (
              <Link to="/parent/reviews" className="btn-primary">Go to reviews</Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!child || !attempt || (attempt.status !== "in_progress" && attempt.status !== "returned")) {
    const waiting = attempt?.status === "submitted";
    return (
      <div className="page">
        <EmptyState
          title={waiting ? "Already sent for review" : "Start this mission first"}
          action={<Link to={`/missions/${mission.slug}`} className="btn-primary">Open {mission.title}</Link>}
        >
          {waiting ? "A grown-up will look at this reflection soon." : "Start the mission, complete it offline, then come back here to reflect."}
        </EmptyState>
      </div>
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const err = validateReflection(text);
    setError(err);
    if (err) {
      document.getElementById("reflection")?.focus();
      return;
    }
    dispatch({ type: "submitReflection", attemptId: attempt.id, reflection: text, feeling, parentAssisted: assisted });
    setSent(true);
  };

  return (
    <div className="page max-w-3xl">
      <Link to={`/missions/${mission.slug}`} className="btn-ghost mb-3 -ml-3 min-h-[44px] px-3">
        <ArrowLeft aria-hidden className="h-5 w-5" /> {mission.title}
      </Link>
      <PageHeader eyebrow={`${child.displayName} · ${mission.title}`} title={isChild ? "What did you learn?" : "Record completion"}>
        {isChild ? "Write it, or tell a grown-up and they can type it for you." : `Help ${child.displayName} put their learning into words.`}
      </PageHeader>

      {attempt.status === "returned" && attempt.history.at(-1)?.note && (
        <div className="mb-5"><Notice title="Your grown-up asked">{attempt.history.at(-1)!.note}</Notice></div>
      )}

      <form noValidate onSubmit={onSubmit} className="card flex flex-col gap-6 p-5 sm:p-6">
        <div>
          <label htmlFor="reflection" className="field-label text-lg">{mission.reflectionQuestion}</label>
          <p id="reflection-help" className="mb-2 text-sm text-ink-muted">
            Please don't include full names, addresses, or school names.
          </p>
          <textarea
            id="reflection"
            className={`input min-h-[160px] text-lg ${error ? "border-coral-dark" : ""}`}
            maxLength={REFLECTION_MAX}
            value={text}
            aria-invalid={!!error}
            aria-describedby={`reflection-help${error ? " reflection-error" : ""}`}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
              dispatch({ type: "saveDraft", attemptId: attempt.id, text: e.target.value });
            }}
          />
          <div className="mt-1 flex justify-between gap-2 text-sm">
            {error ? <p id="reflection-error" role="alert" className="font-bold text-coral-dark">⚠ {error}</p> : <span />}
            <span className="text-ink-muted">{text.length}/{REFLECTION_MAX}</span>
          </div>
        </div>

        <fieldset>
          <legend className="field-label">How did it feel? <span className="font-normal text-ink-muted">(optional)</span></legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(FEELINGS) as Feeling[]).map((k) => (
              <label
                key={k}
                className={`flex min-h-[72px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 p-2 text-center font-bold has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-sun ${feeling === k ? "border-primary bg-primary-light" : "border-cream-300 bg-white"}`}
              >
                <input type="radio" name="feeling" className="sr-only" checked={feeling === k} onChange={() => setFeeling(k)} />
                <span aria-hidden className="text-2xl">{FEELINGS[k].emoji}</span>
                {FEELINGS[k].label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex min-h-[48px] cursor-pointer items-center gap-3 font-semibold">
          <input type="checkbox" className="h-6 w-6 accent-primary" checked={assisted} onChange={(e) => setAssisted(e.target.checked)} />
          A grown-up helped write or talk through this reflection
        </label>

        <button type="submit" className="btn-primary text-lg">
          <Send aria-hidden className="h-5 w-5" /> Send to a grown-up
        </button>
      </form>
    </div>
  );
}

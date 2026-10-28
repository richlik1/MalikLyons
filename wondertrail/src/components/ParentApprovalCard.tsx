import { Check, RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { missionBySlug } from "../data/missions";
import type { ChildProfile, Feeling, MissionAttempt } from "../data/types";
import { Avatar, CategoryBadge, StatusPill } from "./ui";

export const FEELINGS: Record<Feeling, { emoji: string; label: string }> = {
  proud: { emoji: "🏆", label: "Proud" },
  curious: { emoji: "🔍", label: "Curious" },
  tricky: { emoji: "🧗", label: "Tricky but I tried" },
  fun: { emoji: "🎉", label: "Fun" },
};

interface Props {
  attempt: MissionAttempt;
  child: ChildProfile;
  onDecision?: (decision: "approved" | "returned", note: string) => void;
}

export function ParentApprovalCard({ attempt, child, onDecision }: Props) {
  const mission = missionBySlug(attempt.missionSlug);
  const [note, setNote] = useState("");
  const noteId = useId();
  if (!mission) return null;
  const last = attempt.history[attempt.history.length - 1];

  return (
    <article className="card flex flex-col gap-4 p-5" aria-label={`${child.displayName}: ${mission.title}`}>
      <header className="flex flex-wrap items-center gap-3">
        <Avatar id={child.avatar} size={44} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-muted">{child.displayName}</p>
          <h3 className="text-xl">
            <Link to={`/missions/${mission.slug}`} className="hover:underline">{mission.title}</Link>
          </h3>
        </div>
        <StatusPill status={attempt.status} />
      </header>
      <CategoryBadge id={mission.category} />
      <div>
        <p className="text-sm font-bold text-ink-muted">{mission.reflectionQuestion}</p>
        {/* Reflections are rendered as plain text — React escapes any HTML. */}
        <blockquote className="mt-2 whitespace-pre-wrap break-words rounded-2xl bg-cream-100 p-4 text-lg">{attempt.reflection}</blockquote>
        <p className="mt-2 flex flex-wrap gap-x-4 text-sm text-ink-muted">
          {attempt.feeling && <span>Felt: {FEELINGS[attempt.feeling].emoji} {FEELINGS[attempt.feeling].label}</span>}
          {attempt.parentAssisted && <span>Grown-up assisted</span>}
          {attempt.submittedAt && <span>Sent {new Date(attempt.submittedAt).toLocaleDateString()}</span>}
        </p>
      </div>
      {last && attempt.status !== "submitted" && (
        <p className="rounded-2xl bg-primary-light/60 p-3 text-sm">
          <span className="font-bold">Your note:</span> {last.note || "—"}
        </p>
      )}
      {onDecision && attempt.status === "submitted" && (
        <div className="flex flex-col gap-3 border-t border-cream-200 pt-4">
          <div>
            <label htmlFor={noteId} className="field-label">Note for {child.displayName} <span className="font-normal text-ink-muted">(needed to ask for more)</span></label>
            <textarea id={noteId} className="input min-h-[80px]" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Great testing! Can you add what you'd try next?" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary flex-1" onClick={() => onDecision("approved", note)}>
              <Check aria-hidden className="h-5 w-5" /> Approve
            </button>
            <button type="button" className="btn-secondary flex-1" onClick={() => onDecision("returned", note)}>
              <RotateCcw aria-hidden className="h-5 w-5" /> Ask for more learning
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

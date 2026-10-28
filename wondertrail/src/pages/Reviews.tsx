import { useState } from "react";
import { ParentApprovalCard } from "../components/ParentApprovalCard";
import { EmptyState, Notice, PageHeader } from "../components/ui";
import { ACHIEVEMENTS } from "../data/achievements";
import { missionBySlug } from "../data/missions";
import { reducer, type Action } from "../state/demoReducer";
import { useDemo } from "../state/DemoStore";

export default function Reviews() {
  const { state, dispatch } = useDemo();
  const [message, setMessage] = useState<{ tone: "info" | "warn"; text: string } | null>(null);
  const childById = (id: string) => state.children.find((c) => c.id === id);
  const pending = state.attempts.filter((a) => a.status === "submitted" && childById(a.childId));
  const recent = state.attempts
    .filter((a) => (a.status === "approved" || a.status === "returned") && a.reviewedAt && childById(a.childId))
    .sort((a, b) => (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? ""))
    .slice(0, 6);

  const decide = (attemptId: string, decision: "approved" | "returned", note: string) => {
    const action: Action = { type: "review", attemptId, decision, note };
    // Preview the transition to report the outcome (and any new badges) to the parent.
    const next = reducer(state, action);
    if (next.lastError) {
      setMessage({ tone: "warn", text: next.lastError });
      return;
    }
    dispatch(action);
    const a = state.attempts.find((x) => x.id === attemptId)!;
    const name = childById(a.childId)?.displayName ?? "";
    const title = missionBySlug(a.missionSlug)?.title ?? "";
    const newBadges = next.achievements
      .slice(state.achievements.length)
      .map((e) => ACHIEVEMENTS.find((x) => x.id === e.achievementId)?.title)
      .filter(Boolean);
    setMessage({
      tone: "info",
      text:
        decision === "approved"
          ? `Approved ${title} for ${name}.${newBadges.length ? ` New badge${newBadges.length > 1 ? "s" : ""}: ${newBadges.join(", ")}!` : ""}`
          : `Sent ${title} back to ${name} with your note.`,
    });
  };

  return (
    <div className="page">
      <PageHeader eyebrow="Parent review" title="Review completed missions">
        Read each reflection, then approve it for the portfolio or ask for a little more learning.
      </PageHeader>

      <div className="mb-6">
        <Notice tone="warn" title="Simulated approval">
          In the real app, approving will ask you to sign in again, and a secure server function will check your family membership and
          the attempt before saving. Nothing here is secure.
        </Notice>
      </div>

      <div aria-live="polite" className="mb-4">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
      </div>

      <section aria-labelledby="pending-h" className="mb-10">
        <h2 id="pending-h" className="mb-3 text-2xl">Waiting for you ({pending.length})</h2>
        {pending.length === 0 ? (
          <EmptyState title="All caught up!">When a child sends a reflection, it will appear here.</EmptyState>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {pending.map((a) => (
              <ParentApprovalCard key={a.id} attempt={a} child={childById(a.childId)!} onDecision={(d, n) => decide(a.id, d, n)} />
            ))}
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="recent-h">
          <h2 id="recent-h" className="mb-3 text-2xl">Recently reviewed</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {recent.map((a) => <ParentApprovalCard key={a.id} attempt={a} child={childById(a.childId)!} />)}
          </div>
        </section>
      )}
    </div>
  );
}

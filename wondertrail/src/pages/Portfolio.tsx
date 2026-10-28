import { LearningPortfolio } from "../components/LearningPortfolio";
import { Avatar, EmptyState, PageHeader } from "../components/ui";
import { useActiveChild, useDemo } from "../state/DemoStore";

export default function Portfolio() {
  const { state, dispatch } = useDemo();
  const child = useActiveChild();
  const isChild = state.mode === "child";

  return (
    <div className="page">
      <PageHeader eyebrow="Learning portfolio" title={isChild ? "My badges & skills" : `${child?.displayName ?? "Child"}'s learning portfolio`}>
        Skills shown in real life and approved by a grown-up — never screen time.
      </PageHeader>

      {!isChild && state.children.length > 1 && (
        <div role="tablist" aria-label="Choose child" className="mb-6 flex flex-wrap gap-2">
          {state.children.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === child?.id}
              onClick={() => dispatch({ type: "setActiveChild", childId: c.id })}
              className={`chip min-h-[48px] border-2 py-1 pl-1 pr-4 text-base ${c.id === child?.id ? "border-primary bg-primary-light text-primary-dark" : "border-cream-300 bg-white"}`}
            >
              <Avatar id={c.avatar} size={36} /> {c.displayName}
            </button>
          ))}
        </div>
      )}

      {child ? (
        <LearningPortfolio child={child} attempts={state.attempts} achievements={state.achievements} audience={state.mode} />
      ) : (
        <EmptyState title="No child selected" />
      )}
    </div>
  );
}

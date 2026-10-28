import { ageBandRange } from "../data/categories";
import type { ChildProfile } from "../data/types";
import { Avatar } from "./ui";

interface Props {
  child: ChildProfile;
  completed: number;
  pending: number;
  selected?: boolean;
  onSelect?: () => void;
}

export function ChildProfileCard({ child, completed, pending, selected = false, onSelect }: Props) {
  const body = (
    <>
      <Avatar id={child.avatar} />
      <div className="min-w-0 text-left">
        <p className="text-lg font-extrabold">{child.displayName}</p>
        <p className="text-sm text-ink-muted">{ageBandRange(child.ageBand).label}</p>
        <p className="mt-1 text-sm font-semibold">
          {completed} completed{pending > 0 && <span className="text-primary"> · {pending} to review</span>}
        </p>
      </div>
      {selected && <span className="ml-auto chip bg-primary text-white">Selected</span>}
    </>
  );
  const cls = `card flex w-full items-center gap-4 p-4 ${selected ? "ring-4 ring-primary/40" : ""}`;
  return onSelect ? (
    <button type="button" aria-pressed={selected} onClick={onSelect} className={`${cls} hover:border-primary/50`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

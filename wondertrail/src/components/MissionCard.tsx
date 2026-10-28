import { Backpack, Clock, Users } from "lucide-react";
import { Link } from "react-router-dom";
import type { AttemptStatus, Mission } from "../data/types";
import { formatAges, formatMinutes } from "../lib/missions";
import { CategoryBadge, CategoryTile, StatusPill } from "./ui";

interface Props {
  mission: Mission;
  status?: AttemptStatus;
  childFriendly?: boolean;
  warning?: string;
}

export function MissionCard({ mission, status, childFriendly = false, warning }: Props) {
  return (
    <article className="card group relative flex h-full flex-col gap-4 p-5 transition-shadow hover:shadow-lg">
      <div className="flex items-start gap-4">
        <CategoryTile id={mission.category} />
        <div className="min-w-0 flex-1">
          <CategoryBadge id={mission.category} short />
          <h3 className="mt-2 text-xl">
            <Link
              to={`/missions/${mission.slug}`}
              className="after:absolute after:inset-0 after:rounded-3xl focus-visible:outline-none group-focus-within:underline"
            >
              {mission.title}
            </Link>
          </h3>
        </div>
      </div>
      <p className="text-ink-muted">{mission.summary}</p>
      <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-ink-muted">
        <li className="flex items-center gap-1.5">
          <Clock aria-hidden className="h-4 w-4" /> {formatMinutes(mission.durationMinutes)}
        </li>
        <li className="flex items-center gap-1.5">
          <Users aria-hidden className="h-4 w-4" /> {formatAges(mission)}
        </li>
        {!childFriendly && (
          <li className="flex items-center gap-1.5">
            <Backpack aria-hidden className="h-4 w-4" /> {mission.materials.length} materials
          </li>
        )}
      </ul>
      {(status || warning) && (
        <div className="flex flex-wrap gap-2">
          {status && <StatusPill status={status} child={childFriendly} />}
          {warning && <span className="chip bg-cream-200 text-ink-muted">{warning}</span>}
        </div>
      )}
    </article>
  );
}

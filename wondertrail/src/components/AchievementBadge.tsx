import { BookOpen, Coins, Compass, FlaskConical, Footprints, Home, Lock, Palette, Star, type LucideIcon } from "lucide-react";
import type { Achievement } from "../data/types";

const ICONS: Record<Achievement["icon"], LucideIcon> = {
  trail: Footprints,
  star: Star,
  compass: Compass,
  book: BookOpen,
  flask: FlaskConical,
  coins: Coins,
  palette: Palette,
  home: Home,
};

export function AchievementBadge({ achievement, earned, earnedAt }: { achievement: Achievement; earned: boolean; earnedAt?: string }) {
  const Icon = earned ? ICONS[achievement.icon] : Lock;
  return (
    <div className={`flex items-center gap-3 rounded-2xl border-2 p-3 ${earned ? "border-sun bg-sun-light" : "border-dashed border-cream-300 bg-white/60"}`}>
      <span aria-hidden className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${earned ? "bg-sun text-ink" : "bg-cream-200 text-ink-muted"}`}>
        <Icon className="h-6 w-6" />
      </span>
      <div className="min-w-0">
        <p className="font-extrabold">
          {achievement.title}
          <span className="sr-only">{earned ? " — earned" : " — not earned yet"}</span>
        </p>
        <p className="text-sm text-ink-muted">
          {earned && earnedAt ? `Earned ${new Date(earnedAt).toLocaleDateString()}` : achievement.description}
        </p>
      </div>
    </div>
  );
}

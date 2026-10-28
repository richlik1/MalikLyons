import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock,
  Coins,
  FlaskConical,
  HeartHandshake,
  Hourglass,
  Info,
  ListChecks,
  Palette,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { categoryById } from "../data/categories";
import type { AttemptStatus, AvatarId, CategoryId } from "../data/types";

export const CATEGORY_STYLE: Record<CategoryId, { icon: LucideIcon; chip: string; tile: string }> = {
  reading: { icon: BookOpen, chip: "bg-coral-light text-coral-dark", tile: "bg-coral-light" },
  science: { icon: FlaskConical, chip: "bg-[#DDF1E4] text-[#1D5E35]", tile: "bg-[#DDF1E4]" },
  money: { icon: Coins, chip: "bg-sun-light text-sun-dark", tile: "bg-sun-light" },
  creativity: { icon: Palette, chip: "bg-[#ECE4FA] text-[#53349A]", tile: "bg-[#ECE4FA]" },
  life: { icon: ListChecks, chip: "bg-[#DCEAF8] text-[#1C4F86]", tile: "bg-[#DCEAF8]" },
  family: { icon: HeartHandshake, chip: "bg-[#FBE2EC] text-[#8E2655]", tile: "bg-[#FBE2EC]" },
};

export function CategoryBadge({ id, short = false }: { id: CategoryId; short?: boolean }) {
  const s = CATEGORY_STYLE[id];
  const Icon = s.icon;
  const c = categoryById(id);
  return (
    <span className={`chip ${s.chip}`}>
      <Icon aria-hidden className="h-4 w-4" />
      {short ? c.shortName : c.name}
    </span>
  );
}

export function CategoryTile({ id, size = "md" }: { id: CategoryId; size?: "md" | "lg" }) {
  const s = CATEGORY_STYLE[id];
  const Icon = s.icon;
  const dims = size === "lg" ? "h-20 w-20 rounded-3xl" : "h-14 w-14 rounded-2xl";
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center ${dims} ${s.tile} ${s.chip.split(" ")[1]}`}>
      <Icon className={size === "lg" ? "h-10 w-10" : "h-7 w-7"} strokeWidth={2.2} />
    </span>
  );
}

const STATUS: Record<AttemptStatus, { label: string; childLabel: string; cls: string; icon: LucideIcon }> = {
  in_progress: { label: "In progress", childLabel: "On your trail", cls: "bg-sun-light text-sun-dark", icon: Clock },
  submitted: { label: "Awaiting review", childLabel: "Waiting for a grown-up", cls: "bg-primary-light text-primary-dark", icon: Hourglass },
  returned: { label: "More learning requested", childLabel: "Try a little more", cls: "bg-coral-light text-coral-dark", icon: RotateCcw },
  approved: { label: "Approved", childLabel: "Completed!", cls: "bg-[#DDF1E4] text-[#1D5E35]", icon: CheckCircle2 },
};

export function StatusPill({ status, child = false }: { status: AttemptStatus; child?: boolean }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={`chip ${s.cls}`}>
      <Icon aria-hidden className="h-4 w-4" />
      {child ? s.childLabel : s.label}
    </span>
  );
}

const AVATAR_COLORS: Record<AvatarId, { bg: string; face: string; label: string }> = {
  fox: { bg: "#FDE3DE", face: "#F0705F", label: "Fox" },
  owl: { bg: "#ECE4FA", face: "#8B6CCF", label: "Owl" },
  turtle: { bg: "#DDF1E4", face: "#3E9A63", label: "Turtle" },
};

/** Simple original animal-face avatars. No photos are ever collected. */
export function Avatar({ id, size = 56 }: { id: AvatarId; size?: number }) {
  const c = AVATAR_COLORS[id];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`${c.label} avatar`} className="shrink-0">
      <circle cx="32" cy="32" r="32" fill={c.bg} />
      {id === "fox" && <path d="M14 18l10 10M50 18L40 28" stroke={c.face} strokeWidth="7" strokeLinecap="round" />}
      {id === "owl" && <path d="M18 16l6 10M46 16l-6 10" stroke={c.face} strokeWidth="6" strokeLinecap="round" />}
      <circle cx="32" cy="36" r="17" fill={c.face} />
      {id === "owl" ? (
        <>
          <circle cx="25" cy="34" r="6" fill="#fff" />
          <circle cx="39" cy="34" r="6" fill="#fff" />
          <circle cx="25" cy="34" r="2.6" fill="#1E2B2F" />
          <circle cx="39" cy="34" r="2.6" fill="#1E2B2F" />
          <path d="M30 40l2 3 2-3z" fill="#F4B740" />
        </>
      ) : (
        <>
          <circle cx="26" cy="34" r="2.6" fill="#1E2B2F" />
          <circle cx="38" cy="34" r="2.6" fill="#1E2B2F" />
          <path d="M27 42q5 4 10 0" stroke="#1E2B2F" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/** Original decorative trail illustration. */
export function TrailIllustration({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 220" className={className} aria-hidden>
      <rect x="0" y="0" width="320" height="220" rx="32" fill="#D7ECEA" />
      <circle cx="252" cy="54" r="26" fill="#F4B740" />
      <path d="M0 150 L70 86 L120 128 L180 64 L260 150 Z" fill="#0E5A5F" opacity="0.9" />
      <path d="M150 150 L210 104 L250 132 L290 100 L320 124 L320 150 Z" fill="#0A4246" />
      <path d="M0 150 H320 V188 a32 32 0 0 1 -32 32 H32 a32 32 0 0 1 -32 -32 Z" fill="#9FCB8E" />
      <path d="M40 214 C90 188 120 196 160 176 S230 156 262 150" fill="none" stroke="#FFF8EE" strokeWidth="9" strokeLinecap="round" strokeDasharray="2 16" />
      <g transform="translate(250 112)">
        <rect x="0" y="0" width="4" height="40" fill="#1E2B2F" />
        <path d="M4 2 L30 10 L4 18 Z" fill="#F0705F" />
      </g>
      <circle cx="58" cy="176" r="10" fill="#3E9A63" />
      <circle cx="74" cy="182" r="7" fill="#3E9A63" />
    </svg>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn"; title?: string; children: ReactNode }) {
  const Icon = tone === "warn" ? AlertTriangle : Info;
  const cls = tone === "warn" ? "border-coral/40 bg-coral-light/60" : "border-primary/20 bg-primary-light/60";
  return (
    <div className={`flex gap-3 rounded-2xl border p-4 ${cls}`} role={tone === "warn" ? "alert" : "note"}>
      <Icon aria-hidden className={`mt-0.5 h-5 w-5 shrink-0 ${tone === "warn" ? "text-coral-dark" : "text-primary"}`} />
      <div className="text-[0.95rem]">
        {title && <p className="font-bold">{title}</p>}
        <div className="text-ink-muted">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 p-8 text-center">
      <TrailIllustration className="h-24 w-36" />
      <h3 className="text-xl">{title}</h3>
      {children && <p className="max-w-md text-ink-muted">{children}</p>}
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-6">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 className="mt-1 text-3xl sm:text-4xl">{title}</h1>
      {children && <div className="mt-2 max-w-2xl text-lg text-ink-muted">{children}</div>}
    </header>
  );
}

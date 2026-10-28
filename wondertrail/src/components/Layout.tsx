import { ClipboardCheck, Compass, Home, Map, Settings, Trophy, UserRound, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useActiveChild, useDemo } from "../state/DemoStore";
import { ChildPickerModal, GrownUpModal } from "./ModeSwitch";
import { Avatar } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

export function DemoBanner() {
  return (
    <div className="no-print bg-ink px-4 py-2 text-center text-sm font-semibold text-cream-100">
      Demo prototype · fictional families only · sign-in and approvals are simulated and not secure
    </div>
  );
}

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 rounded-xl text-xl font-extrabold text-primary-dark">
      <img src="/favicon.svg" alt="" className="h-9 w-9" />
      <span>WonderTrail</span>
    </Link>
  );
}

export function Layout() {
  const { state } = useDemo();
  const child = useActiveChild();
  const [modal, setModal] = useState<"child" | "parent" | null>(null);
  const isParent = state.mode === "parent";
  const pending = state.attempts.filter((a) => a.status === "submitted").length;

  const nav: NavItem[] = isParent
    ? [
        { to: "/parent", label: "Home", icon: Home },
        { to: "/explore", label: "Explore", icon: Compass },
        { to: "/parent/reviews", label: "Reviews", icon: ClipboardCheck, badge: pending },
        { to: "/portfolio", label: "Portfolio", icon: Trophy },
        { to: "/settings", label: "Settings", icon: Settings },
      ]
    : [
        { to: "/adventure", label: "Adventure", icon: Map },
        { to: "/explore", label: "Explore", icon: Compass },
        { to: "/portfolio", label: "My badges", icon: Trophy },
      ];

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-xl focus:bg-white focus:p-3">
        Skip to content
      </a>
      <DemoBanner />
      <header className="no-print sticky top-0 z-40 border-b border-cream-300/60 bg-cream-50/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Logo />
          <nav aria-label="Main" className="ml-4 hidden flex-1 md:block">
            <ul className="flex gap-1">
              {nav.map((n) => (
                <li key={n.to}>
                  <NavLink end to={n.to} className={({ isActive }) => `btn-ghost min-h-[44px] px-4 text-[0.95rem] ${isActive ? "bg-primary-light" : ""}`}>
                    <n.icon aria-hidden className="h-5 w-5" /> {n.label}
                    {!!n.badge && <Badge n={n.badge} />}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {isParent ? (
              <button type="button" className="btn-coral min-h-[44px] px-4 text-sm" onClick={() => setModal("child")}>
                <Map aria-hidden className="h-5 w-5" /> <span>Child mode</span>
              </button>
            ) : (
              <>
                {child && (
                  <span className="hidden items-center gap-2 font-bold sm:flex">
                    <Avatar id={child.avatar} size={36} /> {child.displayName}
                  </span>
                )}
                <button type="button" className="btn-secondary min-h-[44px] px-4 text-sm" onClick={() => setModal("parent")}>
                  <UserRound aria-hidden className="h-5 w-5" /> Grown-ups
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main">
        <Outlet />
      </main>

      <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-cream-300 bg-white md:hidden">
        <ul className="mx-auto flex max-w-lg justify-around">
          {nav.map((n) => (
            <li key={n.to} className="flex-1">
              <NavLink
                end
                to={n.to}
                className={({ isActive }) =>
                  `relative flex min-h-[64px] flex-col items-center justify-center gap-0.5 text-xs font-bold ${isActive ? "text-primary" : "text-ink-muted"}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={`rounded-full px-4 py-1 ${isActive ? "bg-primary-light" : ""}`}>
                      <n.icon aria-hidden className="h-6 w-6" />
                    </span>
                    {n.label}
                    {!!n.badge && <span className="absolute right-[18%] top-1"><Badge n={n.badge} /></span>}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {modal === "child" && <ChildPickerModal onClose={() => setModal(null)} />}
      {modal === "parent" && <GrownUpModal onClose={() => setModal(null)} />}
    </div>
  );
}

function Badge({ n }: { n: number }) {
  return (
    <span className="ml-1 inline-grid h-5 min-w-5 place-items-center rounded-full bg-coral-dark px-1.5 text-xs font-bold text-white">
      {n}
      <span className="sr-only"> waiting</span>
    </span>
  );
}

/** Blocks parent-only screens in child mode. A UI convenience, not a security boundary. */
export function ParentOnly({ children }: { children: ReactNode }) {
  const { state } = useDemo();
  const [open, setOpen] = useState(false);
  if (state.mode === "parent") return <>{children}</>;
  return (
    <div className="page">
      <div className="card mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
        <span aria-hidden className="text-5xl">🔒</span>
        <h1 className="text-3xl">Grown-ups only</h1>
        <p className="text-ink-muted">This part of WonderTrail is for parents and guardians.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link to="/adventure" className="btn-primary">Back to my adventure</Link>
          <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>I'm a grown-up</button>
        </div>
      </div>
      {open && <GrownUpModal onClose={() => setOpen(false)} />}
    </div>
  );
}

import { KeyRound, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ageBandRange } from "../data/categories";
import { useDemo } from "../state/DemoStore";
import { Avatar } from "./ui";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button, [href], input, textarea")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="no-print fixed inset-0 z-50 grid place-items-end bg-ink/50 p-4 sm:place-items-center" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="card w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="modal-title" className="text-2xl">{title}</h2>
          <button type="button" onClick={onClose} className="btn-ghost -mr-2 -mt-2 min-h-[44px] px-3" aria-label="Close">
            <X aria-hidden className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Hand the device to a child: pick whose adventure to open. */
export function ChildPickerModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useDemo();
  const navigate = useNavigate();
  return (
    <Modal title="Who's going on an adventure?" onClose={onClose}>
      <ul className="flex flex-col gap-2">
        {state.children.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="card flex w-full items-center gap-4 p-3 text-left hover:border-primary"
              onClick={() => {
                dispatch({ type: "setActiveChild", childId: c.id });
                dispatch({ type: "setMode", mode: "child" });
                onClose();
                navigate("/adventure");
              }}
            >
              <Avatar id={c.avatar} size={48} />
              <span>
                <span className="block text-lg font-extrabold">{c.displayName}</span>
                <span className="text-sm text-ink-muted">{ageBandRange(c.ageBand).label}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {state.children.length === 0 && <p className="text-ink-muted">Add a child profile in Family Settings first.</p>}
    </Modal>
  );
}

/** Return to the parent experience. Demo only — no real verification happens. */
export function GrownUpModal({ onClose }: { onClose: () => void }) {
  const { dispatch } = useDemo();
  const navigate = useNavigate();
  return (
    <Modal title="Grown-ups only" onClose={onClose}>
      <p className="text-ink-muted">
        In the real app, switching back to the parent view will ask the parent to sign in again.
      </p>
      <p className="mt-2 rounded-2xl bg-sun-light p-3 text-sm font-semibold text-sun-dark">
        Demo prototype: there is no real check here, and it is not secure.
      </p>
      <button
        type="button"
        className="btn-primary mt-5 w-full"
        onClick={() => {
          dispatch({ type: "setMode", mode: "parent" });
          onClose();
          navigate("/parent");
        }}
      >
        <KeyRound aria-hidden className="h-5 w-5" /> Continue as grown-up (demo)
      </button>
    </Modal>
  );
}

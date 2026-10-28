import { Download, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Modal } from "../components/ModeSwitch";
import { Avatar, Notice, PageHeader } from "../components/ui";
import { ageBandRange } from "../data/categories";
import { DEMO_FAMILY } from "../data/profiles";
import type { ChildProfile } from "../data/types";
import { useDemo } from "../state/DemoStore";

const ALWAYS_OFF = [
  "Advertising and ad tracking",
  "Behavioural profiling or third-party analytics on children",
  "Public child profiles",
  "Location collection",
  "Photo uploads",
  "Chat, messaging, and AI conversations",
];

export default function Settings() {
  const { state, dispatch } = useDemo();
  const [confirmDelete, setConfirmDelete] = useState<ChildProfile | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [status, setStatus] = useState("");

  const exportData = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      note: "WonderTrail demo export — fictional data from this browser only.",
      family: DEMO_FAMILY,
      children: state.children,
      attempts: state.attempts.map(({ draftReflection: _d, ...a }) => a),
      achievements: state.achievements,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "wondertrail-demo-export.json";
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Export downloaded.");
  };

  return (
    <div className="page max-w-4xl">
      <PageHeader eyebrow="Family settings" title={DEMO_FAMILY.name}>
        Manage child profiles, privacy, and your family's data.
      </PageHeader>
      <div aria-live="polite" className="mb-4">{status && <Notice>{status}</Notice>}</div>

      <section aria-labelledby="profiles-h" className="card mb-6 p-5 sm:p-6">
        <h2 id="profiles-h" className="text-2xl">Child profiles</h2>
        <p className="mb-4 text-ink-muted">Children don't have their own accounts, emails, or passwords. We only keep a display name and age band.</p>
        <ul className="flex flex-col gap-3">
          {state.children.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-4 rounded-2xl bg-cream-100 p-3">
              <Avatar id={c.avatar} size={48} />
              <div className="flex-1">
                <p className="text-lg font-extrabold">{c.displayName}</p>
                <p className="text-sm text-ink-muted">{ageBandRange(c.ageBand).label}</p>
              </div>
              <button type="button" className="btn-ghost min-h-[44px] px-3 text-coral-dark hover:bg-coral-light" onClick={() => setConfirmDelete(c)}>
                <Trash2 aria-hidden className="h-5 w-5" /> Delete profile
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn-secondary mt-4" disabled title="Available in Phase 2">
          Add a child profile (coming in Phase 2)
        </button>
      </section>

      <section aria-labelledby="privacy-h" className="card mb-6 p-5 sm:p-6">
        <h2 id="privacy-h" className="text-2xl">Privacy</h2>
        <p className="mb-4 text-ink-muted">These are always off in WonderTrail — they are not settings you need to find.</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {ALWAYS_OFF.map((x) => (
            <li key={x} className="flex items-center gap-3 rounded-2xl bg-cream-100 p-3">
              <span className="chip bg-ink text-white">Off</span> {x}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="data-h" className="card p-5 sm:p-6">
        <h2 id="data-h" className="text-2xl">Your data</h2>
        <p className="mb-4 text-ink-muted">
          In this demo, everything lives in this browser only. In the real app, export and deletion will run on our servers and be
          verified.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={exportData}>
            <Download aria-hidden className="h-5 w-5" /> Export family data (JSON)
          </button>
          <button type="button" className="btn-secondary" onClick={() => setConfirmReset(true)}>
            <RotateCcw aria-hidden className="h-5 w-5" /> Restore sample demo data
          </button>
        </div>
      </section>

      {confirmDelete && (
        <Modal title={`Delete ${confirmDelete.displayName}'s profile?`} onClose={() => setConfirmDelete(null)}>
          <p className="text-ink-muted">This removes the profile, all of their reflections, and badges from this demo. It can't be undone (except by restoring sample data).</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-coral flex-1"
              onClick={() => {
                dispatch({ type: "deleteChild", childId: confirmDelete.id });
                setStatus(`${confirmDelete.displayName}'s profile and data were deleted.`);
                setConfirmDelete(null);
              }}
            >
              Delete profile
            </button>
            <button type="button" className="btn-secondary flex-1" onClick={() => setConfirmDelete(null)}>Cancel</button>
          </div>
        </Modal>
      )}
      {confirmReset && (
        <Modal title="Restore sample data?" onClose={() => setConfirmReset(false)}>
          <p className="text-ink-muted">This replaces all demo progress in this browser with the original sample family.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={() => {
                dispatch({ type: "reset" });
                setStatus("Sample demo data restored.");
                setConfirmReset(false);
              }}
            >
              Restore
            </button>
            <button type="button" className="btn-secondary flex-1" onClick={() => setConfirmReset(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

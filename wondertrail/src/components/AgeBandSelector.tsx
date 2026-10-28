import { AGE_BANDS } from "../data/categories";
import type { AgeBand } from "../data/types";

interface Props {
  value: AgeBand | "all";
  onChange: (v: AgeBand | "all") => void;
  allowAll?: boolean;
  label?: string;
}

export function AgeBandSelector({ value, onChange, allowAll = true, label = "Age band" }: Props) {
  const options: { id: AgeBand | "all"; label: string }[] = [
    ...(allowAll ? [{ id: "all" as const, label: "All ages" }] : []),
    ...AGE_BANDS,
  ];
  return (
    <fieldset>
      <legend className="field-label">{label}</legend>
      <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-2xl bg-cream-200 p-1">
        {options.map((o) => {
          const on = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.id)}
              className={`min-h-[44px] rounded-xl px-4 text-sm font-bold ${on ? "bg-primary text-white shadow" : "text-ink-muted hover:bg-white"}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

import { CATEGORIES } from "../data/categories";
import type { CategoryId } from "../data/types";
import { CATEGORY_STYLE } from "./ui";

interface Props {
  selected: CategoryId[];
  onChange: (next: CategoryId[]) => void;
}

/** Multi-select category toggles. Selection is shown by a check mark and border, not by colour alone. */
export function CategoryFilter({ selected, onChange }: Props) {
  const toggle = (id: CategoryId) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <fieldset>
      <legend className="field-label">Category</legend>
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => {
          const on = selected.includes(c.id);
          const s = CATEGORY_STYLE[c.id];
          const Icon = s.icon;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(c.id)}
              className={`chip min-h-[44px] border-2 px-4 ${on ? `${s.chip} border-current` : "border-cream-300 bg-white text-ink-muted hover:border-primary/40"}`}
            >
              <Icon aria-hidden className="h-4 w-4" />
              {c.name}
              {on && <span aria-hidden>✓</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

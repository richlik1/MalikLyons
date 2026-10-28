import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { initialState, reducer, type Action, type DemoState } from "./demoReducer";

export const STORAGE_KEY = "wondertrail-demo-v1";

function load(): DemoState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoState;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.attempts)) return { ...parsed, lastError: null };
    }
  } catch {
    // Storage blocked or corrupted: fall back to fresh demo data.
  }
  return initialState();
}

interface Store {
  state: DemoState;
  dispatch: (a: Action) => void;
}

const Ctx = createContext<Store | null>(null);

export function DemoStoreProvider({ children, initial }: { children: ReactNode; initial?: DemoState }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => initial ?? load());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore: the demo still works for this session without persistence.
    }
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemo() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useDemo must be used inside DemoStoreProvider");
  return s;
}

export function useActiveChild() {
  const { state } = useDemo();
  return state.children.find((c) => c.id === state.activeChildId) ?? null;
}

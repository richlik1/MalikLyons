/**
 * Estimated cost per call, from published per-million-token list prices.
 * Used for spending limits; reconcile against the Anthropic Console for billing.
 */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

const PRICES: Record<string, Price> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** Unknown models (e.g. a fallback we have no row for) are priced at the most expensive rate. */
const CONSERVATIVE: Price = { input: 10, output: 50, cacheRead: 1 };

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function estimateCostUsd(model: string, usage: UsageLike): number {
  const p = PRICES[model] ?? CONSERVATIVE;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const dollars =
    usage.input_tokens * p.input +
    usage.output_tokens * p.output +
    cacheRead * p.cacheRead +
    cacheWrite * p.input * 1.25; // 5-minute cache writes bill at 1.25x input
  return dollars / 1_000_000;
}

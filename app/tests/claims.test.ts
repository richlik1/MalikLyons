import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Guardrail: user-facing source must not contain performance statistics, testimonials or
// guarantees. TrendSet has no validated results yet. If a claim becomes supported by evidence,
// add it to ALLOW with a link to the evidence in docs/evidence/.
const ROOT = path.resolve(__dirname, "../src");
const USER_FACING = /\.(tsx)$|lib\/(consent|tryon\/service|limits)\.ts$/;

const PATTERNS: [RegExp, string][] = [
  [/\b\d+(\.\d+)?\s?%/, "percentage statistic"],
  [/\b\d+(\.\d+)?\s?[×x]\s/, "multiplier claim (e.g. 2.4×)"],
  [/\b\d+\s?[–-]\s?\d+\s?seconds\b|\bunder \d+\s?s(ec|econds)?\b/i, "unmeasured latency claim"],
  [/testimonial|trusted by|case stud(y|ies)|as seen in/i, "social proof"],
  [/(?<!not |n't |or )guarantee/i, "guarantee"],
  [/\b(increase|boost|lift|grow|reduce|cut)(s|ed)?\s+(your\s+)?(sales|conversion|revenue|returns|aov)\b/i, "outcome claim"],
  [/\$\s?\d[\d,]*(k|K)?\s+(in\s+)?(revenue|saved|lift)/, "revenue claim"],
];
const ALLOW: string[] = [];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

export function scanText(src: string): string[] {
  const hits: string[] = [];
  src.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|import )/.test(line)) return;
    // Only inspect text content and string literals, not Tailwind classes or code.
    const text = (line.match(/>([^<>{}]+)<|"([^"]{2,})"|'([^']{2,})'|`([^`]{2,})`/g) ?? []).join(" ");
    for (const [re, label] of PATTERNS) {
      if (re.test(text) && !ALLOW.some((a) => line.includes(a))) hits.push(`${i + 1}: ${label}: ${line.trim().slice(0, 120)}`);
    }
  });
  return hits;
}

describe("claims scanner self-test", () => {
  it("flags the kinds of claims found in the legacy prototype", () => {
    const legacy = [
      `{[["2.4×", "Conversion lift"], ["68%", "Return reduction"]].map(x => x)}`,
      `quote: "Trendset reduced our return rate by 60% in the first month.",`,
      `<p>This usually takes 10–30 seconds.</p>`,
      `<h2>Trusted by 500 brands</h2>`,
      `<p>We boost your conversion overnight</p>`,
    ];
    for (const l of legacy) expect(scanText(l), l).not.toEqual([]);
  });
  it("allows honest disclaimers", () => {
    expect(scanText(`"It does not show accurate sizing or guarantee fit."`)).toEqual([]);
  });
});

describe("no unsupported claims in user-facing source", () => {
  const targets = files(ROOT).filter((f) => USER_FACING.test(f.replace(/\\/g, "/")));

  it("scans user-facing files", () => expect(targets.length).toBeGreaterThan(5));

  for (const file of targets) {
    it(path.relative(ROOT, file), () => {
      const hits = scanText(readFileSync(file, "utf8"));
      expect(hits).toEqual([]);
    });
  }
});

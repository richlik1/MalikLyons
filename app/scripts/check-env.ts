// Usage: npm run check:env   (reads the current process environment, e.g. via `vercel env pull`)
// Prints variable names and problems only — never values. Exits 1 on errors.
import { validateEnv } from "../src/lib/env.ts";

const report = validateEnv(process.env);
console.log(`APP_ENV: ${report.appEnv}`);
console.log(`features: ${JSON.stringify(report.features)}`);
for (const w of report.warnings) console.log(`WARN  ${w}`);
for (const e of report.errors) console.log(`ERROR ${e}`);
console.log(report.ok ? "environment OK" : `environment INVALID (${report.errors.length} error(s))`);
process.exit(report.ok ? 0 : 1);

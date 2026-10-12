# Test evidence

Raw outputs from the production-readiness audit. Labels follow `docs/14-production-readiness-audit.md`.

| File | What ran | Against |
|---|---|---|
| `unit-tests.txt` | Vitest unit tests + TypeScript check | In-process, mocked I/O |
| `integration-tests.txt` | RLS / storage / grants / migrations | **Local stack** of official Supabase images (not hosted Supabase) |
| `e2e-tests.txt` | Built app, real HTTP, real sessions | Local stack + **FASHN contract stub** (no AI) |
| `staging-gate.txt` | Private-site gate | Local `next start` with `APP_ENV=staging` |
| `live-tests.txt` | Real external services | **Skipped** (no credentials) |

No file here contains credentials. Secrets used in local runs were generated per run and discarded.
When live tests run, add their outputs here with "LIVE" in the title line.

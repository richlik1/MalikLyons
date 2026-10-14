# UI preview (local, demo data)

Screenshots of the running app, captured by `app/scripts/preview-screens.mjs` against the local
Supabase-compatible stack (`app/scripts/local-stack.sh`).

- Products are **drawn demo illustrations** (`app/scripts/render-demo-assets.mjs`).
- The shopper photo is a **drawn figure**, not a real person.
- The try-on result is the **FASHN contract stub's "STUB OUTPUT — Not AI" card**. No AI generated it.
  Stub runs are logged as model `contract-stub` at $0.
- Counts in Studio and Admin come from this demo session only.

Requires `npm i --no-save playwright-core@1.56.1` (not a project dependency) and Chromium.

Regenerate: start the stack, gateway, stub and app (see `docs/07-deployment.md` §7), then
`node scripts/render-demo-assets.mjs && node scripts/preview-screens.mjs ../docs/preview`.

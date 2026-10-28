# WonderTrail — Phase 1 clickable prototype

**Working name only** (not a cleared trademark or domain) · Ages 7–12 · LYONS Technologies

A real-world learning adventure app: children pick a mission, put the device down, do a hands-on activity, come back to reflect,
and a parent approves it into a learning portfolio.

> **This is a demo.** All families and children are fictional. Nothing is sent to a server: progress is stored only in this
> browser's `localStorage`. The parent/child switch and parent approval are **simulated and not secure**. Do not use it with
> real children's information.

This is a standalone project. It does not use, import from, or connect to StayOps, Keen Prospect AI or any other LYONS project.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + UI flow tests (Vitest + Testing Library)
npm run typecheck
npm run build
```

Stack: React 18, TypeScript, Vite, Tailwind CSS 3, React Router 6, lucide-react icons. It needs no paid APIs, no analytics, and
no external fonts or CDNs.

## Screens

| Route | Screen |
| --- | --- |
| `/` | Welcome and introduction, privacy commitments |
| `/parent` | Parent dashboard: child selector, missions in progress, pending reviews, recommendations |
| `/adventure` | Child adventure dashboard (no external links) |
| `/explore` | Mission explorer: category, age band, time, search |
| `/missions/:slug` | Mission details: objective, materials, steps, safety, guidance, start |
| `/missions/:slug/submit` | Completion and reflection (required text, optional feeling, grown-up-assisted flag) |
| `/missions/:slug/print` | Printable activity card |
| `/parent/reviews` | Parent review: approve or ask for more learning (simulated) |
| `/portfolio` | Learning portfolio: completed missions, skills, badges |
| `/settings` | Family settings mockup: profiles, privacy, export, delete, restore demo data |

`/parent`, `/parent/reviews` and `/settings` show a "Grown-ups only" screen in child mode. This is for convenience only and
is not a security boundary.

## Project layout

```
src/
  data/        types.ts, categories.ts (6 categories, 3 age bands, skills), missions.ts (5 missions),
               achievements.ts, profiles.ts (fictional family)
  lib/         missions.ts (filters, age-band rules), progress.ts (achievements, skills, validation)
  state/       demoReducer.ts (demo rules that mirror the future server functions), DemoStore.tsx (context + localStorage)
  components/  MissionCard, MissionDetail, CategoryFilter, AgeBandSelector, ChildProfileCard, ParentApprovalCard,
               AchievementBadge, LearningPortfolio, PrintableMissionCard, Layout, ModeSwitch, ui
  pages/       one file per screen
  test/        logic.test.ts, flows.test.tsx
```

The mission data shapes (`Mission`, `MissionAttempt`, `ApprovalEvent`, `Achievement`, `ChildAchievement`) match the planned
tables (`missions`, `mission_steps`, `mission_skills`, `mission_attempts`, `approval_events`, `achievements`,
`child_achievements`), so the data can be seeded into Supabase without reshaping.

## Demo rules (enforced in `demoReducer.ts`, to be moved server-side in Phase 2)

- A mission outside a child's age band can't be started, and the screen says why.
- Starting a mission twice reuses the open attempt instead of creating a duplicate.
- A reflection is required (10–600 characters). Reflections are always rendered as plain text.
- Only parent mode can review, and only attempts with the status `submitted`. Reviewing the same attempt twice is rejected.
- "Ask for more learning" requires a note. The child can then revise and resubmit.
- Achievements are awarded only when a mission is approved, and each one is awarded at most once.
- Deleting a child profile removes that child's attempts and badges.

## Known limitations (by design for Phase 1)

- No authentication, no backend, no RLS. All "security" is simulated in the browser.
- Mode switching and approval have no real re-verification.
- Only 5 of the 30 planned missions are included, and mission content still needs safety, developmental and accessibility
  review. Life Skills has no sample mission yet.
- There is no onboarding or consent flow, and "Add child profile" is disabled.
- It is not a PWA and has no offline caching yet (Phase 4). Printing uses the browser's print dialog.
- Export downloads this browser's demo data as JSON. Deletion only affects local demo data.

See the Phase 1 report in the pull request or handoff notes for the next steps for Phase 2.

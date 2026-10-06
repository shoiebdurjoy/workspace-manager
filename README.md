# TBB Workspace

Think Big Brand's internal ClickUp-style workspace for video production: Workspace → Space → Folder → List → Task → Subtask, with the TBB QC workflow. Built in 15 gated phases; see [docs/TBB_15_PHASE_ROADMAP.md](docs/TBB_15_PHASE_ROADMAP.md).

| Phase | Status |
| :--- | :--- |
| 1 Audit and architecture | Done |
| 2 Application shell and design system | Done |
| 3 Backend and database foundation | Done |
| 4 Authentication, users and teams | Done ([details](docs/TBB_PHASE_4_AUTH_AND_TEAMS.md)) |
| 5 Workspace hierarchy (Spaces, Folders, Lists) | Done ([details](docs/TBB_PHASE_5_HIERARCHY.md)) |
| 6 Task engine | Next |

## Stack

Vite, React 18, TypeScript (strict), Tailwind + Radix/shadcn, TanStack Query, React Router, Supabase (Postgres + Auth + RLS).

## Setup

```bash
npm install
cp .env.example .env     # then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev              # http://localhost:8080
```

`.env` holds the project URL and the **publishable** key (plus an optional `VITE_APP_URL`, left empty locally and set to the public URL in Vercel production; see [docs/TBB_PHASE_4_AUTH_AND_TEAMS.md](docs/TBB_PHASE_4_AUTH_AND_TEAMS.md)). Never put a service-role/secret key or the database password in a `VITE_` variable.

## Scripts

| Command | What it does |
| :--- | :--- |
| `npm run dev` / `npm run build` | Dev server / production build |
| `npm run lint` | ESLint (0 errors, 0 warnings required) |
| `npm run typecheck` | `tsc --noEmit` under `strict` |
| `npm test` | Unit, component and integration tests (Vitest) |
| `npm run test:coverage` | Same, with coverage gates for the new code |
| `npm run test:db` | Offline RLS/permission suite: every migration run in an in-process Postgres |
| `npm run test:live` | Live RLS suite against the linked Supabase project (see [supabase/README.md](supabase/README.md)) |

## Database

All schema changes are numbered migrations in `supabase/migrations/`, applied with the Supabase CLI. See [supabase/README.md](supabase/README.md) for the rules that must not be broken (explicit grants, the private schema, no anonymous access).

## Documentation

`docs/` is the source of truth: requirements, architecture, database, permission model, testing strategy, roadmap and the per-phase notes.

# TBB Workspace — Supabase

- `migrations/` — the only way the database schema changes. Applied with the Supabase CLI
  (`supabase db push`), never by pasting SQL in the dashboard. Applied migrations are
  immutable: fix forward with a new numbered file.
- `config.toml` — Supabase CLI settings (local stack + project name).
- `tests/rls-check.mjs` — permission / RLS tests that run **every migration in order**
  inside an in-process Postgres. Offline, no Docker, never touches a real database.
- `tests/live-rls-e2e.mjs` — the same rules verified on the **real project** through the
  real Auth + REST API, with temporary users that are always cleaned up.

## Migrations

| File | Purpose |
|---|---|
| `…000001_tbb_core_schema.sql` | Tables, hierarchy, roles, RLS policies, guard triggers |
| `…000002_not_null_defaults.sql` | `NOT NULL` on defaulted columns |
| `…000003_table_grants.sql` | Explicit table privileges (this project grants nothing automatically) |
| `…000004_private_helpers_and_initplan.sql` | Auth helpers moved to the non-exposed `private` schema; `(select auth.uid())` in policies |
| `…000005_teams_and_invitations.sql` | Phase 4: pods (`teams`, `team_members`), `workspace_invitations` (claimed on confirmed e-mail), first-workspace-only rule |

## Rules that must not be broken

- **Grant explicitly.** Tables created by a migration get no privileges for `anon` /
  `authenticated`. Add `GRANT`s in the same migration that creates the table. Never use
  `ALTER DEFAULT PRIVILEGES` to auto-grant.
- **Never expose the `private` schema** in the project's API "Exposed schemas" setting or in
  `config.toml` `[api].schemas`. It holds the SECURITY DEFINER authorization helpers.
- **`anon` has no access** to application tables. Do not add anonymous policies or grants.
- **Role lives in `workspace_members.role`**, never in `profiles.role`.
- **TBB is single-workspace.** After the first workspace exists the database refuses client-created workspaces.
- **Invitations only match confirmed e-mails** (`auth.users.email_confirmed_at`). Never claim on an unconfirmed address.
- **Auth settings live in `config.toml`** and are pushed with `npx supabase config push`. Run `npx supabase config diff` first: it must show only the changes you intend.

## Connect to the hosted project (once)

    npx supabase login
    npx supabase link --project-ref <project-ref>
    npx supabase db push --dry-run     # shows what would run, changes nothing
    npx supabase db push               # applies pending migrations
    npx supabase db lint --linked --schema public
    npx supabase db advisors --linked

The database password (if the CLI asks) is typed into its prompt and never stored in this repo.

## Tests

    npm run test:db      # offline RLS suite (run after every migration change)
    npm test             # unit tests (vitest)

    # LIVE: writes temporary users/rows to the linked project, then deletes them.
    # You must confirm the project ref (the first label of VITE_SUPABASE_URL in .env):
    #   PowerShell:  $env:TBB_E2E_CONFIRM_PROJECT_REF = "<ref>"; npm run test:live
    #   bash:        TBB_E2E_CONFIRM_PROJECT_REF=<ref> npm run test:live
    # Leftovers from an aborted run can be removed with:  node supabase/tests/live-rls-e2e.mjs --cleanup-only

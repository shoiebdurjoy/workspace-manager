# TBB Workspace V2 — Phase 4: Authentication + Users + Teams
**Document ID:** `docs/TBB_PHASE_4_AUTH_AND_TEAMS.md`
**Roadmap reference:** `docs/TBB_15_PHASE_ROADMAP.md` Phase 04
**Status:** Implemented

---

## 1. What Phase 4 delivers

| Roadmap item | Delivered |
| :--- | :--- |
| Real signup, login, session persistence, password reset | `AuthProvider` on Supabase Auth (PKCE). Pages: `/login`, `/register`, `/forgot-password`, `/reset-password`. |
| Profile auto-creation trigger | Phase 3 `handle_new_user` (always `EDITOR`; metadata roles ignored). |
| Role assignment (Owner, Admin, Manager, QC, Editor, Client Viewer) | Workspace roles in `workspace_members.role`; managed on `/team` (Members). |
| Creative pods (`teams`, `team_members`) | Migration 5 + `/team?tab=pods`. |
| Strip all localStorage auth simulation | Removed. The only browser storage is the Supabase session (managed by supabase-js) and UI preferences (sidebar, theme). Enforced by an automated audit test. |
| Loading / error handling | Loading, error-with-retry, deactivated and no-workspace states in `ProtectedRoute`. |
| "Unable to connect to authentication server" on network failure | `describeAuthError`; unit and component tested. No offline fallback exists. |
| Auth integration tests | `src/context/__tests__/AuthProvider.test.tsx` (login, bad credentials, session restore, role, sign-out, network failure). |
| Acceptance: real users register and log in; zero fake sessions | Verified against the live project (see section 6). |
| Must NOT implement: task creation, workspace navigation | Not implemented. Later-phase navigation is shown disabled ("Soon"), never simulated. |

Also delivered because the shell would otherwise have shipped fake data: the demo space tree, demo notifications, the offline badge, the quick-task modal and every legacy prototype page were removed from `src/` (see section 7).

## 2. Access model: sign-up is open, access is by invitation

`docs/TBB_REQUIREMENTS.md` 1 states there is no public self-signup into TBB. Anyone can create a *login*, but a login alone grants access to nothing.

```
 register ──► confirm e-mail ──► signed in, member of NO workspace ──► /onboarding
                                         ▲
 Owner/Admin invites the e-mail address ─┘  (membership + role created by the database)
```

* **Invitations** (`workspace_invitations`): created by OWNER/ADMIN with a role (never OWNER). Claimed automatically when the address belongs to a **confirmed** account: at sign-up if already confirmed, when the confirmation link is used, or immediately if the account already exists. Unconfirmed addresses never claim, so nobody can claim an invitation by typing someone else's e-mail.
* **First-run bootstrap**: while no workspace exists, the first signed-in person can create it on `/onboarding` and becomes OWNER. After that the database refuses workspace creation from clients (TBB is single-workspace).
* **No e-mail is sent by the app** for invitations yet: tell the person to register with that address (Phase 14 adds invite e-mails via a server function).

## 3. Authorization: two tiers

1. **Database (real enforcement):** RLS + guard triggers from migrations 1–5.
2. **Interface (convenience):** `src/lib/permissions.ts` mirrors the matrix in `docs/TBB_PERMISSION_MODEL.md` 2 row for row (every cell is a unit test). `<Can perform="...">`, `useCan()` and `ProtectedRoute capability="..."` hide what a role cannot do. Hiding a control never grants or removes access.

Route gating: signed-out → `/login` (with a validated return path); signed in without a workspace → `/onboarding`; missing capability → `/unauthorized`; deactivated → blocked screen.

## 4. Pods (teams)

`teams(id, workspace_id, name, description, color, lead_id)` and `team_members(team_id, user_id, workspace_id)`.

* OWNER/ADMIN create, edit and delete pods and choose the lead; OWNER/ADMIN/PRODUCTION_MANAGER add and remove people; staff can read; client viewers cannot.
* Only workspace members can join a pod or lead one; leaving the workspace removes pod seats and the lead position.
* Deviation from the proposal: `team_members` has no `role` column. The lead is `teams.lead_id`, so a second role field would be a second source of truth.

## 5. Operating checklist (Supabase dashboard / CLI)

| Item | State |
| :--- | :--- |
| Password policy (min 8, upper, lower, digit) enforced **server-side** | Pushed with `supabase config push` |
| Redirect allow-list and Site URL for confirmation / reset links | Pushed with `supabase config push`: Site URL `https://workspace-manager-five.vercel.app`; allow-list `https://workspace-manager-five.vercel.app/**`, `http://localhost:8080/**`, `http://127.0.0.1:8080/**`. **Add the custom domain here (and set `VITE_APP_URL`) when one is attached.** |
| Confirm e-mail required | On |
| Public sign-ups | On (required for invited people to create their login). Safe: a login grants no access. |
| **Custom SMTP** | **Not configured.** Supabase's built-in sender is limited to a few e-mails per hour and is not for production. Configure SMTP (Dashboard → Authentication → SMTP) before onboarding the team. |
| Leaked-password protection, CAPTCHA | Plan-dependent; consider before wider rollout. |

Never put the service-role / secret key or the database password in any `VITE_` variable.

### Deployment and e-mail links (Vercel)

Every link Supabase e-mails is built from the app's public URL (`src/lib/app-url.ts`):

| Link | Requested redirect |
| :--- | :--- |
| Sign-up confirmation | `<app URL>/auth/callback` (exchanges the PKCE code, then continues to Home / onboarding) |
| Password reset | `<app URL>/reset-password` |

`<app URL>` is `VITE_APP_URL` when set (a valid https origin, or http only for localhost), otherwise `window.location.origin`. Locally this is `http://localhost:8080`; nothing is hard-coded and an automated audit fails if a host appears in auth code.

**Supabase silently replaces a redirect that is not on its allow-list with the Site URL.** That is how a production sign-up once produced `http://localhost:8080/?code=...`: the allow-list matched only the bare origin, not `/login`, and the Site URL was still localhost. The URL Configuration above (path wildcards plus a production Site URL) is therefore part of the app's correctness, and is verified by requesting `/auth/v1/verify?redirect_to=...` and checking where it lands.

Vercel environment variables (Project -> Settings -> Environment Variables):

| Variable | Value | Scope |
| :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | the project URL | Production, Preview, Development |
| `VITE_SUPABASE_ANON_KEY` | the **publishable** key (never the secret / service-role key) | Production, Preview, Development |
| `VITE_APP_URL` | `https://workspace-manager-five.vercel.app` (your custom domain later) | **Production only** |

`vercel.json` rewrites every path to `index.html` so deep links (`/auth/callback`, `/reset-password`, `/team`) work on refresh. Preview deployments use their own origin, which is not allow-listed, so e-mail links created there fall back to the production Site URL; test e-mail flows on production or add the preview pattern to the allow-list. Vite bakes `VITE_` variables in at build time: **redeploy after changing them.**

## 6. Verification performed

* `npm test`: 200 unit/component/integration tests; coverage on new code ≥ 97% (gate 85%).
* `npm run test:db`: 163 offline RLS checks including pods, invitations and the single-workspace rule.
* `npm run test:live` (needs `TBB_E2E_CONFIRM_PROJECT_REF`): 157 checks as real signed-in users against the live project, including invitations, the sign-in gate for unconfirmed accounts and uninvited users; all temporary data removed afterwards.
* The exact data-layer functions used by the UI were run against the live project for owner, admin, editor and outsider.
* `tsc` strict: 0 errors. `eslint`: 0 errors, 0 warnings. `vite build`: largest chunk 171 kB.
* Browser: signed-out redirect, form validation, expired reset link, 404, mobile layout, no console errors.

## 7. Removed prototype code

The legacy WorkWise prototype (pages Dashboard, Tasks, TaskNew, Workspaces, WorkspaceNew, WorkspaceDetail, Payments, Reports, LandingPage; kanban and dashboard components; `services/database.ts`, `services/mockData.ts`; `types/index.ts`; the old Navbar/Sidebar) was deleted from `src/`. It targeted the old flat schema and mock auth. Nothing was lost: it remains in Git history, and the uncommitted working-tree versions are preserved on the **local-only** branch `legacy-prototype-wip`. Each is rebuilt properly in its roadmap phase (hierarchy: 5, tasks: 6, workflow: 7, views: 8, home/inbox: 11, payments/dashboards: 14).

## 8. Known limits

* Deactivating a user needs a service-side action until the Phase 14 admin screen.
* Editors can still change status/position on any task in the workspace until tasks have assignees (Phase 6).
* The Spaces section of the sidebar was an honest empty state in Phase 4; Phase 5 fills it (see `docs/TBB_PHASE_5_HIERARCHY.md`).
* The DesignSystemShowcase page contains sample strings for style-guide components; it is behind login.

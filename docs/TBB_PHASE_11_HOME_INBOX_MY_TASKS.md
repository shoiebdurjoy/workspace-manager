# TBB Workspace V2 — Phase 11: Home, Inbox and My Tasks
**Document ID:** `docs/TBB_PHASE_11_HOME_INBOX_MY_TASKS.md`
**Roadmap reference:** `docs/TBB_15_PHASE_ROADMAP.md` Phase 11
**Status:** Implemented (migration `20260930000016_home_inbox_my_tasks.sql`)

---

## 1. Principle

Every number, list and notification on these pages is something the database computed or recorded for the signed-in person, under their own RLS. There is no demo data and nothing is counted in the browser except the one rule that only the workflow knows ("needs my action", see 2).

Who sees what is decided by the database. The interface hides what a role cannot use, but hiding is never the control: the new read functions are `SECURITY INVOKER` and refuse client viewers and non-members (`42501`).

## 2. My Tasks (`/my-tasks`, `/my-tasks/tasks/:taskId`)

- The same task workspace as a list or Everything (List / Board / Table, filters, search, keyboard, bulk actions, the task sheet), with one fixed scope: **assigned to me as editor or QC reviewer**. The request always carries `people = [me]`; a filter the person adds narrows it, never replaces it.
- A new grouping, **My work** (default here, offered only here):
  1. **Needs my action**: the next workflow step is mine (`needsMyAction`, the same rule as everywhere), whatever the date
  2. **Overdue / Due today / Next 7 days / Later / No date**, by the **earlier of the QC due date and the client deadline** (the Home summary uses the same rule)
  3. **Finished**
  Each task is in exactly one group, the first that matches. "Waiting on others" is not a separate group: it could never receive a task, those tasks sit in their date group and their status pill shows they are with QC.
- **Revision feedback:** for an editor, a task sent back by QC shows `Revision N: <first line of the latest note>` under the title with **more / less** to read it all in place. All notes on screen are read in one call (`latest_revision_notes`).
- Landing page: after sign-in (and from `/`), **editors and QC specialists start on My Tasks, everyone else on Home** (`landingFor`, `lib/redirect.ts`). A link that was heading somewhere specific still goes there.

## 3. Inbox (`/inbox`)

The full-page version of the Phase 10 bell, for the production team.

- **Tabs:** Inbox (not Done), Done, All. **Filters:** Mentions, Comments, Assignments, Stage changes, Unread only. Tab and filters live in the address (`?tab=done&kind=mention&unread=1`); unknown values are dropped.
- Grouped by the viewer's calendar day: Today, Yesterday, Earlier this week, Older; "Load older" pages by keyset.
- Per row: open (marks it read and goes to the comment or activity), **Mark read / unread**, **Done / Move back to Inbox**. Bulk: **Mark all read**, **Clear read** (every read notification still in the Inbox becomes Done).
- Keyboard: `j` / `k` (or the arrows) move, `Enter` opens, `e` Done (or back), `u` read / unread.
- Every action is optimistic across all cached lists and put back, with the reason shown, if the database refuses.
- The sidebar **Inbox** badge counts **unread and not Done** (a real count; none shown at zero). The bell keeps counting all unread. Both refresh live (Realtime), on focus, and by a 60 s poll fallback. Ctrl+K and the bell panel link to the Inbox.

### Database (migration 16)
- `notifications.archived_at` (**Done**). `GRANT UPDATE (read_at, archived_at)`: the recipient changes exactly those two columns. `guard_notification()` keeps everything else immutable, forces the **server's time** for both (a supplied time is ignored, the first time is kept while it stays set), and still lets only the account-deletion `actor_id` null-out through. Not even an Owner can touch a colleague's notification.
- Index `idx_notifications_inbox (user_id, created_at DESC, id) WHERE archived_at IS NULL`.
- No new way to *create* notifications: the Phase 10 triggers remain the only writers.

## 4. Home (`/home`)

Personal first, workspace below. For the production team (client viewers see only the workspace card and "Your access"):

- **My work:** Needs my action, Overdue, Due today, Next 7 days. All link to My Tasks. (Needs my action is counted from my assigned tasks with the workflow rule; the other three come from the database summary.)
- **Unread notifications** (latest 5, linking to what they are about) and **Recently updated, assigned to me** (latest 5).
- **QC specialists:** **My QC queue** (tasks they review that wait for QC, oldest first, with how long) and **Revisions in progress**. **Managers:** the same lists for every task, with the reviewer / editor shown.
- **Managers only:** **Across the workspace**: open, overdue, no editor, no QC reviewer, each linking to Everything filtered (`/everything?overdue=1&hide=1`, `?editor=none`, `?qc=none`).
- Unchanged below: workspace counts for staff, spaces, "Your access".

### `my_home_summary(workspace, day_start, day_end, week_end)`
One round trip, `SECURITY INVOKER`. Day boundaries are the **viewer's** (computed in the browser: local midnight today and tomorrow, and eight days ahead); the function refuses unordered or missing boundaries (`22023`). Same plan-stability pattern as migration 15 (small tables read once into materialized CTEs). Queues are capped at 50 rows each. The browser reads the JSON defensively (`mapHomeSummary`): anything missing or malformed becomes zero or empty, never an error.

### `latest_revision_notes(task_ids)`
The latest revision request (note, number, who, when) per task, from `task_status_events` under RLS; at most 1,000 ids per call; tasks that never had one, or that the caller cannot read, are absent.

## 5. Security verification
- Offline suite (*Phase 11* section, 33 checks): every role against the summary and the notes, cross-workspace attempts, bad input, `SECURITY INVOKER`, anon refused; Done set by the recipient only with server time, a colleague and the Owner refused, exactly two updatable columns, the Inbox index; manager counts equal a direct count.
- Live suite (*Phase 11* section): the same through the real API with real triggers and the real workflow (a task moved through the stages by its editor and QC), summary latency, revision notes, Done by the recipient and refusals for a colleague / the owner. As before it counts production's own rows before and after and removes everything it created.

## 6. Known limitations
- Home's "Needs my action" is computed from my first 500 assigned tasks (the same cap as every task view, with the notice there); the database counts (overdue, due today, next 7 days) are exact.
- The Home summary is not live; it refreshes on focus and after any task change in the app.
- Notification e-mail / push, due-date reminders and assigned-comment / reply feeds are out of scope (they need a scheduler or threaded comments).
- Done is per notification; there is no "snooze".

## 7. Tests
Unit / component: `lib/__tests__/task-view.test.ts` (My work grouping), `lib/__tests__/collaboration.test.ts` (Inbox address state and day grouping), `database/__tests__/collaboration-data.test.ts` and `home-data.test.ts` (Inbox queries, Done, summary mapping and day bounds), `pages/__tests__/my-tasks.test.tsx`, `inbox.test.tsx`, `home-hub.test.tsx` (every role), updated shell and auth tests. Database: the *Phase 11* section of `supabase/tests/rls-check.mjs` and of `supabase/tests/live-rls-e2e.mjs`.

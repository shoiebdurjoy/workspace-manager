# TBB Workspace V2 — Phases 8 and 9: Views, Search, Filters and Sorting
**Document ID:** `docs/TBB_PHASE_8_9_VIEWS_AND_SEARCH.md`
**Roadmap reference:** `docs/TBB_15_PHASE_ROADMAP.md` Phases 08 and 09
**Status:** Implemented (Phase 8 needs no migration; Phase 9 is migrations `20260930000011_task_search.sql` and `20260930000015_search_tasks_plan_stability.sql`)

---

## 1. Phase 8: three views over the same tasks

| View | What it is | Where the work happens |
| :--- | :--- | :--- |
| **List** | The grouped, inline-editable list from Phase 6/7 | `ListView.tsx` |
| **Board** | One column per workflow stage, a card per task | `BoardView.tsx` |
| **Table** | A dense grid: sortable header, choosable columns, inline editing, multi-select, bulk bar | `TableView.tsx` |

All three read **one** query and share **one** selection and the same inline controls; only the layout differs. Switching view keeps the search, filters, sort, grouping and the open task.

### Board: drag and drop is the workflow, not a shortcut around it
- A drop calls the same `useMoveRunner` the status pill and the detail sheet use. `canMove(workflow, task, actor, to)` decides, with the same rules as the `enforce_task_workflow` trigger: allowed roles per edge, editor only on their own tasks, required information (editor, review link, final export, a revision note).
- A move that needs more information (a review link, a note) opens the **same dialog** as the status pill; dropping never skips it.
- An invalid move is refused cleanly: the card goes back where it was and a toast says why. While dragging, columns the person cannot drop on are visibly disabled.
- The move is optimistic **only because the rollback is reliable**: the previous row is restored if the database refuses, and a stale move (someone else moved the task first, `TB409`) reloads the task so the person sees the real stage.
- A keyboard / screen-reader person has the same move through the card's menu ("Move to …"), which lists only the stages the person can reach and says why the others are unavailable.

### Table
- Sortable column headers (the sort goes to the database, section 2), a column chooser (kept per list in `localStorage`, a display preference only), inline editing of title, priority, dates, editor and QC (the same controls as the list), row selection with the shared bulk bar (move, assign, priority, due date, delete: each only where the role may).

### View state lives in the address
`?view=board`, `?q=`, `?status=`, `?sort=`, … are query parameters, so a link opens the same view for whoever receives it and Back behaves. `localStorage` only holds per-list **preferences** (last view mode, group-by, sort, collapsed groups, table columns); nothing the application depends on for correctness or security.

## 2. Phase 9: search, filters, sorting, grouping, in the database

> "Do not implement 'load every task and filter in React'."

One SQL function, `public.search_tasks(workspace, query, filters, sort, dir, limit, offset)`, answers every task view (a list, a folder, a space, or **Everything**). The browser asks for a page and gets a page plus the total (`count(*) OVER()` on every row).

### Security
- **SECURITY INVOKER**: every table it reads is read under the **caller's own RLS**. Search can never show a row the person could not read with a plain `SELECT`; RLS remains the boundary. It also refuses non-members and client viewers outright (`42501`).
- No string from the client is spliced into SQL: values are bound with `format('%L')` as **typed literals** (`uuid[]`, `text[]`, `timestamptz`); the sort key and direction are a **whitelist**; filter lists are bounded (at most 100 values) and malformed ids are rejected, not ignored.
- A literal `%` or `_` typed into the box is text, not a wildcard; SQL typed into the box is just a word that matches nothing.

### What can be filtered (all in the database)
Free text (title, brief, short id, list / folder / space / editor / QC names; every word must match somewhere) · stage · priority · editor (or nobody) · QC reviewer (or nobody) · internal QC due date, client deadline, created date (presets such as *today, this week, overdue, next 7 days*, or a `from..to` range resolved on the viewer's local day) · aspect ratio · space / folder / list · "assigned to me" · overdue · hide finished. Combined filters are an AND; several values inside one filter are an OR.

**Client:** TBB has no client entity. A client's pipeline is its **list** (and folder), so "filter by client" is the list / folder / space filter. This is documented, not hidden.

### Sorting and grouping
Sort keys: manual order, title, priority, internal QC due date, client deadline, created, updated, stage, editor, QC reviewer. Ties break on `id`, so paging is stable and never repeats or skips a row. Grouping (status, editor, priority, due date, and list in views that span several lists, or none) is done on the loaded rows, in the database's own order.

### Performance
- **Indexes:** `pg_trgm` GIN indexes on `tasks.title` and `tasks.description` make `%word%` index-assisted; the short-id search is a range scan on the primary key; name matches (list, folder, space, editor, QC) are resolved first against the small tables they live in, so every alternative in the `WHERE` is a condition on `tasks` itself and indexable.
- **Measured** (offline suite): a rare word in **40,007** tasks returns the 16 right rows in ≈1.4–1.9 s *inside the in-process WASM Postgres* (native Postgres is far faster), and the plan is asserted to use the trigram index. A filtered, sorted page of a 40,000-row list returns exactly one page of 500. The live suite repeats the check through the real API against 3,000 rows and prints the latency.
- **Stable plan (migration `20260930000015_search_tasks_plan_stability.sql`).** The live suite found the first filtered page of a freshly filled 3,000-task list taking 6–8 s (over the 8 s statement timeout): with statistics not yet refreshed, the planner expected one task and re-scanned `lists` and `spaces` once per task, running their RLS check on every row each time. The query now reads the workspace's lists/folders/spaces and the workflow's stages once into materialized CTEs, and cuts the page before counting subtask progress. Same signature, columns, results and RLS (still `SECURITY INVOKER`).
- Paging is by `limit` / `offset` with the total on every row. The view fetches pages of 500 back to back (so group counts and the "N tasks" total are exact) up to a cap of **5,000 rows per view**; past that it says "Showing the first 5,000 of N tasks. Narrow them down with filters or search." and the database is still what narrows it.

### Permission-scoped results
The offline and live suites assert, for each role, that results never include another workspace's tasks, that client viewers and outsiders are refused, and that `search_tasks` is not `SECURITY DEFINER`.

## 3. URL state

| Parameter | Meaning |
| :--- | :--- |
| `view` | `list` / `board` / `table` |
| `q` | free text |
| `status`, `priority`, `editor`, `qc`, `aspect` | comma-separated values (`editor=none` = nobody) |
| `due` (internal QC due), `client` (**client deadline**, not a client entity), `created` | a preset or `YYYY-MM-DD..YYYY-MM-DD` |
| `space`, `folder`, `list` | ids (validated as ids, never text) |
| `mine`, `needs` (needs my action), `overdue`, `hide` | `1` |
| `group`, `sort`, `dir` | grouping and order |

Nothing sensitive is ever placed in the address: only ids, enumerated keys and the typed search words the person chose to share.

## 4. Known limitations
- **No virtual scrolling.** A view loads at most 5,000 rows (with a visible notice) and renders them all; narrowing by filter / search is the way to see the rest. Windowed rendering is the next step if a single view ever needs more.
- **Board:** no drag-reorder *within* a column (manual order is changed in the List), no keyboard drag (the card's Move menu is the keyboard path).
- **Table:** columns cannot be resized.
- **"Needs my action"** is the one refinement done on the already-filtered page (the next-step rule lives in the workflow, not in SQL); the filtered page is exact, the refinement only narrows it.
- **Client** is the list / folder (no client entity exists yet).
- Due-date **reminders** need a scheduler; none exists, so none are promised (see Phase 10).

## 5. Tests
Unit/component: `lib/__tests__/task-filters.test.ts`, `task-views.test.ts`, `components/tasks/__tests__/task-views.test.tsx` (real workflow rules through a mocked `DndContext`), `task-finder.test.tsx`, `everything.test.tsx`, updated list / detail / hierarchy / shell tests. Database: the *Phase 9* section of `supabase/tests/rls-check.mjs` and the live section of `supabase/tests/live-rls-e2e.mjs`.

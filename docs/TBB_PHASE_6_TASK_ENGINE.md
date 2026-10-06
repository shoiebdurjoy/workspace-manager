# TBB Workspace V2 — Phase 6: Task Engine & Video Deliverable Metadata
**Document ID:** `docs/TBB_PHASE_6_TASK_ENGINE.md`
**Roadmap reference:** `docs/TBB_15_PHASE_ROADMAP.md` Phase 06
**Status:** Implemented (migration `20260930000007_task_engine.sql`)

---

## 1. What Phase 6 delivers

| Roadmap item | Delivered |
| :--- | :--- |
| Task creation, comprehensive creation modal | `TaskDialog` (title, brief, priority, aspect ratio, editor, QC reviewer, internal QC due, client deadline, four links) plus title-only quick add in the list |
| Task detail drawer (`TaskDetailSheet`) | Side sheet over the list, deep-linkable at `/spaces/:s/lists/:l/tasks/:t`; one request loads the task, assignees and checklist |
| Primary Editor + QC Specialist assignment | `task_assignees` (one `EDITOR`, one `QC_REVIEWER` per task), set atomically by `set_task_assignee()` |
| Aspect ratio, Drive raw footage link, Frame.io review link, final export link | `aspect_ratio`, `raw_footage_link`, `project_file_link`, `review_link`, `final_export_link` with URL validation in the browser **and** as database `CHECK`s |
| Internal QC due date, client deadline | `due_date` (already existed; it is the internal QC date) and new `client_deadline` |
| Subtask checklist, progress | Existing `subtasks` table, one level; tick / add / rename / delete; progress bar and `n/m` counts |
| Transactional task insertion with assignee linking | `create_task()` inserts the task and both assignees in one transaction |
| Task CRUD, URL validator, subtask progress tests | `tasks-data`, `tasks` (lib), `task-list`, `task-detail`, `task-routes` suites; offline RLS suite; live RLS suite |
| **Must NOT implement:** dynamic workflow customizer, multi-view engine | Not implemented (see section 6) |

## 2. Reconciling the documents with the database

Three documents describe tasks differently. The **migrations and the roadmap win**, because they are what exists and what the phase is defined by:

* `docs/TBB_DATABASE_PROPOSAL.md` 5.1 puts subtasks in `tasks.parent_id` and uses `status_id` / `priority_id` foreign keys into `workflows` / `statuses` / `priorities`. The built schema (migration 1) and the roadmap ("Tables `tasks`, `task_assignees`, `subtasks`") use a **separate `subtasks` table** and **CHECK-constrained `status` / `priority` text**. Phase 6 follows the built schema. Subtasks stay exactly one level deep (no recursion).
* The proposal has both `assigned_editor_id` / `assigned_qc_id` columns *and* `task_assignees`. Phase 6 uses the roadmap's `task_assignees` only, so there is one source of truth.
* The proposal defaults `aspect_ratio` to `9:16`. An unset ratio is honest, so it is nullable with no default. The allowed values are the proposal's (`9:16`, `16:9`, `1:1`, `4:5`, `OTHER`); the roadmap names the first two.

**Deliberately not built (deferred, with their phase):** `revision_count`, `completed_at` and QC gating (Phase 7); payment fields and financial privacy (not in the Phase 6 roadmap; they need column-level visibility rules); `task_dependencies`; comments, attachments, activity, notifications (Phase 10); custom fields (Phase 12).

## 3. Data model

```
tasks            (existing) + aspect_ratio, raw_footage_link, project_file_link, review_link,
                 final_export_link, client_deadline          -- all nullable, all CHECK-validated
task_assignees   task_id, role_type (EDITOR | QC_REVIEWER), user_id, workspace_id*, assigned_by*, assigned_at
                 PRIMARY KEY (task_id, role_type)             -- one of each; *derived by trigger
subtasks         (existing, unchanged)
```

* **Status** stays the generic list from migration 1 (`TODO … CLOSED`). The configurable TBB workflow replaces it in Phase 7; `TASK_STATUSES` in `src/lib/tasks.ts` is the single place the UI reads labels from, and the access rules only depend on "late-stage" and "finished" groups, so Phase 7 swaps the source, not the screens.
* **Links** must be `http(s)://host…`, no whitespace, at most 2048 characters. `javascript:`, `data:` and scheme-less values are refused by the database, so a stored value can always be rendered as an `href`.
* **Ordering**: `position`, then `created_at`, then `id` (a total order). New tasks append under a per-list advisory lock, so two people adding at once never share a position.

### Assignment rules (database trigger `guard_task_assignee`)

| Slot | Eligible workspace roles |
| :--- | :--- |
| Editor | Owner, Admin, Production Manager, Editor |
| QC reviewer | Owner, Admin, Production Manager, QC Specialist |

The person must be an active member of the task's workspace, and **the same person can never hold both slots on one task** (nobody QCs their own cut). The UI offers only eligible people; the trigger is the enforcement.

## 4. Permissions (migration 7 tightened the guards)

Migration 1 promised "Phase 6 adds assignees; tighten then", and `docs/TBB_PERMISSION_MODEL.md` 3 says editors write operational fields **only on tasks assigned to them**. Before this migration any editor could change the status of *any* task.

| Action | Owner / Admin / Prod. Manager | QC Specialist | Editor | Client viewer |
| :--- | :---: | :---: | :---: | :---: |
| See tasks | ✅ | ✅ | ✅ | ❌ (fails closed) |
| Create / delete task, assign, edit brief, dates, raw + final links | ✅ | ❌ | ❌ | ❌ |
| Status | any | any except to/from Completed/Closed | **assigned task only**, never into/out of Ready-to-deliver or later | ❌ |
| Review link, project file link | ✅ | ❌ | **assigned task only** | ❌ |
| Tick subtasks | ✅ | ✅ | **assigned task only** | ❌ |
| Add / rename / delete subtasks, reorder tasks | ✅ | ❌ | ❌ | ❌ |

`create_task`, `set_task_assignee` and `move_task` are `SECURITY INVOKER`: every row they touch is still checked by the caller's own RLS and guard triggers, so they add no privilege. `task_assignees` has RLS (read: staff; write: managers) and explicit grants (nothing for `anon`).

## 5. Architecture

```
src/lib/tasks.ts                  pure logic: labels, validation, URL rule, dates, progress, ordering,
                                  assignee eligibility, taskAccess() (UI mirror of the guards)
src/database/tasks.ts             service: listTasks (paged), getTask, createTask (RPC), updateTask (partial),
                                  deleteTask, setTaskAssignee, moveTask, subtask CRUD, readable error mapping
src/database/task-mappers.ts      row <-> domain mapping and the two select strings
src/hooks/use-tasks.ts            one query / mutation hook per action; keys scoped per workspace
src/components/tasks/             TaskList, TaskRow, TaskDialog, TaskDetailSheet, SubtaskChecklist,
                                  AssigneeSelect, DeleteTaskDialog, TaskBadges, fields (inline edit)
src/pages/TaskRedirect.tsx        /tasks/:taskId -> canonical URL
```

* **Routes.** `/spaces/:s/lists/:l/tasks/:t` is a *child route* of the list, so `ListPage` stays mounted while the sheet opens and closes (no refetch, no flicker, scroll position kept). `/tasks/:taskId` resolves the task's list and space and forwards to the canonical URL; it is what notifications, search and My Tasks will link to. Unknown, deleted, foreign and malformed ids all show the same "not found".
* **Detail sections are independent blocks.** Comments, attachments, activity and QC history (later phases) are added as further sections or tabs without touching the existing fields.
* **No N+1.** A list page is one request: assignees and checklist counts are embedded. The detail is one request. Names come from the already-cached member list.
* **Concurrency.** Updates send only the changed field, so two people editing different fields never overwrite each other; every successful or failed save refetches the truth. Ticking a subtask is the one optimistic update (safe to roll back). The same field edited by two people at once is last-write-wins, which is acceptable until Phase 10 adds activity history; realtime push is out of scope.
* **Paging.** 100 tasks per page with "Show more"; the total comes from the same request (`count: exact`). Virtual scrolling arrives with the multi-view work in Phase 8.
* **Inline editing.** Fields save on blur / Enter, Escape reverts (and does not close the sheet on its first press), invalid input is explained under the field and never sent, a refused save puts the field back to the saved value.

## 6. Out of scope here (and where it lands)

| Not in Phase 6 | Phase |
| :--- | :--- |
| TBB workflow statuses, transition rules, revision counter, QC rejection notes | 7 |
| Board / Table views, drag-and-drop, grouped-by-status list, virtualisation, batch `reorder_tasks` | 8 |
| Search, filters, saved sorting | 9 |
| Comments, attachments, activity feed, notifications | 10 |
| My Tasks, Inbox, personal dashboard | 11 |
| Custom fields, templates, automations | 12 |
| Calendar, timeline, workload | 13 |

Moving a task up/down (`move_task`) is the Phase 6 answer to "task ordering": atomic, permission-checked and server-side so it works on a partially loaded list. Phase 8 adds drag-and-drop on top of the same positions.

## 7. Verification

* `npm run typecheck`, `npm run lint`, `npm test` (unit, component and routing), `npm run test:coverage` (task code is in the 85% gate), `npm run build`.
* `npm run test:db`: the offline RLS suite applies every migration (including 7) in an in-process Postgres and asserts roles, columns, eligibility, atomicity, ordering and cascades.
* `npm run test:live`: the same rules on the real project through the real Auth + REST API, including the exact embedded query shapes the app uses, with temporary users that are always cleaned up; it also asserts the task tables hold exactly the rows they held before the run.

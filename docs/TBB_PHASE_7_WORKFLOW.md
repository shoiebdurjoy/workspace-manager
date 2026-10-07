# TBB Workspace V2 — Phase 7: TBB Workflow & Status Engine
**Document ID:** `docs/TBB_PHASE_7_WORKFLOW.md`
**Roadmap reference:** `docs/TBB_15_PHASE_ROADMAP.md` Phase 07
**Status:** Implemented (migration `20260930000008_workflow_engine.sql`)

---

## 1. What Phase 7 delivers

Phase 7 (plus the first-QC production analytics of section 8) is not a relabelling of the Phase 6 statuses. It is a state machine the database enforces:

| Roadmap item | Delivered |
| :--- | :--- |
| Configurable workflow engine | `workflows`, `workflow_statuses`, `workflow_transitions`: the workflow is data (not a `CHECK` list), one default workflow per workspace, seeded for every workspace that exists and every new one (trigger) |
| The ten TBB stages | Exactly the canonical names, in TBB's order (section 2) |
| Role-based transition rules | Each move lists the roles that may make it; the `enforce_task_workflow` trigger refuses anything else on **every** write path (RPC, REST `PATCH`, `INSERT`) |
| QC gating / editors cannot approve their own videos | Approval moves belong to QC Specialist / Production Manager (and Owner / Admin); an editor has no edge into `QC - APPROVED (RTD)` or later |
| Revision counter auto-increment | `tasks.revision_count`, incremented by the trigger on entering `QC - REVISION NEEDED`; nobody can set it directly |
| QC rejection notes prompt | Entering the revision stage **requires** a note (database-enforced); the UI asks for it in a dialog; the editor sees the latest note on the task |
| Interactive status pill dropdown, role-gated options | One `WorkflowPicker` for list rows and the detail panel: next steps as named actions, admin overrides apart, unavailable stages disabled **with the reason**; the bulk bar uses the same rules |
| Status transition unit tests, RLS rejection tests | `lib/workflow.test.ts` (full role x edge matrix), offline RLS suite (Phase 7 section), live suite (Phase 7 section) |
| **Must NOT implement:** views other than the List view | Not implemented |

Also delivered: a status-history foundation (`task_status_events`), stale-move protection, required information per stage (editor, review link, final export), and a "Needs my action" filter.

## 2. The stages

| # | Key | Name | Category | Meaning | Needs |
|---|---|---|---|---|---|
| 1 | `TO_BE_EDITED` | TO BE EDITED | not started | Brief and footage received; not in the edit pipeline yet. **Initial stage.** | |
| 2 | `IN_EDIT` | IN EDIT | in progress | Accepted into the edit pipeline; waiting for an editor. | |
| 3 | `ASSIGNED` | ASSIGNED | in progress | In an editor's queue. | editor |
| 4 | `STARTED_EDITING` | STARTED EDITING | in progress | The editor is working on the cut. | editor |
| 5 | `QC_FIRST_APPROVAL` | QC - FIRST APPROVAL | in review | First cut submitted; waiting for QC. | editor, review link |
| 6 | `QC_REVISION_NEEDED` | QC - REVISION NEEDED | in review | QC or the client asked for changes; back with the editor. | editor, **note**; counts a revision |
| 7 | `QC_FINAL_APPROVAL` | QC - FINAL APPROVAL | in review | Revised or passed cut waiting for final QC. | editor, review link |
| 8 | `QC_APPROVED_RTD` | QC - APPROVED (RTD) | ready | Passed QC; ready to deliver. | |
| 9 | `SENT_TO_CLIENT` | SENT TO CLIENT | client | Final export delivered to the client. | final export link |
| 10 | `CLOSED` | CLOSED | completed | Done (never "overdue", shown as finished). | |

Colours are part of the configuration (grey, three oranges for the edit stages, yellows for QC, solid red for revision, green for approved / closed, sky for the client). The revision stage is deliberately the only solid red pill, and a row in revision gets a red edge and a "Rev n" tag, so a cut sent back is unmistakable in any list.

## 3. Moves (the state machine)

Roles: **M** = Owner, Admin, Production Manager. **Q** = M + QC Specialist. **E** = M + the editor **assigned to the task**.

| From | To | Action | Kind | Who |
|---|---|---|---|---|
| TO BE EDITED | IN EDIT | Move to edit queue | forward | M |
| TO BE EDITED | ASSIGNED | Assign to editor | forward | M |
| IN EDIT | ASSIGNED | Assign to editor | forward | M |
| IN EDIT | TO BE EDITED | Back to To be edited | back | M |
| ASSIGNED | STARTED EDITING | Start editing | forward | E |
| ASSIGNED | IN EDIT | Back to edit queue | back | M |
| STARTED EDITING | QC - FIRST APPROVAL | Submit for QC | forward | E |
| STARTED EDITING | ASSIGNED | Pause editing | back | E |
| QC - FIRST APPROVAL | QC - APPROVED (RTD) | Approve (ready to deliver) | forward | Q |
| QC - FIRST APPROVAL | QC - FINAL APPROVAL | Pass to final approval | forward | Q |
| QC - FIRST APPROVAL | QC - REVISION NEEDED | Request revision | reject | Q |
| QC - FIRST APPROVAL | STARTED EDITING | Withdraw from QC | back | E |
| QC - REVISION NEEDED | QC - FINAL APPROVAL | Submit revision | forward | E |
| QC - FINAL APPROVAL | QC - APPROVED (RTD) | Approve (ready to deliver) | forward | Q |
| QC - FINAL APPROVAL | QC - REVISION NEEDED | Request another revision | reject | Q |
| QC - APPROVED (RTD) | SENT TO CLIENT | Send to client | forward | Q |
| QC - APPROVED (RTD) | QC - FINAL APPROVAL | Reopen QC | back | Q |
| SENT TO CLIENT | CLOSED | Close | forward | M |
| SENT TO CLIENT | QC - REVISION NEEDED | Client requested changes | reject | Q |
| CLOSED | SENT TO CLIENT | Reopen | back | M |

Everything else is refused: "a task cannot move from X to Y" (not an edge) or "your role cannot move a task from X to Y" (an edge, not yours). **Owner / Admin** may move a task to any stage outside these edges as an **override** (the permission model: they "override QC decisions"); it is recorded with `is_override = true`, and the stage's requirements still apply. A Production Manager follows the graph (they have QC powers plus closing, no overrides). Client viewers, outsiders and signed-out users cannot move tasks; an editor can move only the tasks assigned to them.

### The revision cycle

`QC - FIRST APPROVAL` → (Request revision, note) → `QC - REVISION NEEDED` (Rev 1) → (Submit revision) → `QC - FINAL APPROVAL` → (Request another revision, note) → Rev 2 → … → (Approve) → `QC - APPROVED (RTD)` → (Send to client, final export) → `SENT TO CLIENT` → (Client requested changes, note) → Rev 3 → … → (Close) → `CLOSED`.

Each entry into `QC - REVISION NEEDED` adds one to `revision_count` and records the note with that revision number. A resubmitted revision always goes to **final** approval, never back to first approval.

## 4. Decisions (and how conflicting sources were reconciled)

* **Stage order.** The roadmap lists `TO BE EDITED, ASSIGNED, STARTED EDITING, IN EDIT, …`; the Phase 7 brief (and TBB's ClickUp) orders them `TO BE EDITED, IN EDIT, ASSIGNED, STARTED EDITING, …`. The brief wins. Meanings: *IN EDIT* = accepted into the edit pipeline, awaiting an editor; *ASSIGNED* = in a specific editor's queue; *STARTED EDITING* = being edited.
* **Who approves.** The roadmap's database note says "only QC Specialists / Admins" set `QC - APPROVED (RTD)`; the permission model's matrix also gives this to Production Managers. Production Managers keep it (they run production), Editors never get it.
* **Editors and IN EDIT.** The permission model lets editors move between ASSIGNED, STARTED EDITING and IN EDIT. With IN EDIT now meaning "unassigned edit queue", an editor's moves are Start editing, Pause editing, Submit for QC, Withdraw from QC and Submit revision; putting work back into the queue is a manager's call.
* **QC delivers.** `SENT TO CLIENT` needs the final export; QC may now set `final_export_link` (the column guard allows it), otherwise QC could never deliver.
* **Requirements are enforced where they belong.** Editor / review link / final export / note are checked by the trigger, not only in the UI. The RPC can attach the review link or final export in the same atomic call, so "Submit for QC" is one step.
* **Notes need the RPC.** A revision note travels from `transition_task()` to the trigger through a transaction-local setting; a plain REST `PATCH` cannot supply one and therefore cannot request a revision. A note never carries over to a later move.
* **Stale moves.** The UI sends the stage the person saw (`p_expected_from`); if someone else moved the task meanwhile the move is refused (custom SQLSTATE `TB409`, migration 10: the standard `40001` makes the hosted API hang until it times out, which the live suite caught), nothing changes, and the UI reloads the task.
* **Data-driven, one workflow per workspace.** New workspaces get the TBB workflow automatically. Nobody (not even the Owner) can write the workflow tables through the API.
* **Status keys in the app are no longer a hard-coded list.** Grouping, filters, colours, "finished" and the picker all come from the loaded workflow.

## 5. Data model

```
workflows              id, workspace_id, name, is_default        -- one default per workspace
workflow_statuses      workflow_id, key, name, category, color, position, description, is_initial,
                       requires_editor, requires_review_link, requires_final_export, requires_note, counts_revision
workflow_transitions   workflow_id, from_key, to_key, label, kind (forward | back | reject), roles[]
tasks                  + revision_count (system-managed); status default TO_BE_EDITED; old CHECK dropped
task_status_events     id, task_id, workspace_id, from_status, to_status, actor_id, note, is_override,
                       revision_number, created_at                -- append-only, written by trigger only
```

Existing tasks were mapped: `TODO → TO_BE_EDITED`, `IN_PROGRESS → STARTED_EDITING`, `IN_QC → QC_FIRST_APPROVAL`, `READY_TO_DELIVER → QC_APPROVED_RTD`, `CLIENT_REVIEW → SENT_TO_CLIENT`, `COMPLETED → CLOSED`, and each got one "created" history event.

### Enforcement

* `enforce_task_workflow` (BEFORE INSERT/UPDATE on `tasks`, runs after the column guard): validates the stage, the edge and role (or Owner/Admin override), the requirements, and maintains `revision_count`.
* `log_task_status_event` (AFTER INSERT/UPDATE OF status): writes the history row with the note, override flag and revision number.
* `transition_task(task, to, note, review_link, final_export_link, expected_from)`: **SECURITY INVOKER**, so RLS and every guard apply as the caller; locks the row, checks the expected stage, attaches links, moves. Executable by `authenticated` only.
* Workflow tables and history: `SELECT` for internal staff only, no write privileges for `authenticated` (explicitly revoked, in case the project ever auto-grants), nothing for `anon`.

## 6. The interface

* **`WorkflowPicker`** (list rows, detail panel): shows the current stage and "Stage n of 10"; lists *Next steps* as named actions with their target stage and what they will ask for; then *Admin override* (Owner / Admin only); then *Not available*, disabled, each with its reason. Searchable, keyboard-friendly. A stage with no possible move is a plain pill whose tooltip says why.
* **`TransitionDialog`**: asks for exactly what the next stage needs: the editor (assigned first, then moved), the review link, the final export, or what to change. Validates on the spot; a refused move keeps what was typed.
* **Detail panel workflow section**: stage, revision tag, progress through the stages, the steps this person can take as buttons (primary forward, red-outlined reject, quiet back), "Waiting on …" when nothing is theirs, and while a cut is sent back, the latest request: who asked, when, and the note.
* **List**: stage groups in workflow order; quick add only in groups a new task can reach in one plain step; "Needs my action" quick filter; revision rows marked.
* **Bulk**: each selected task goes through `transition_task` on its own, from the stage the person saw. A stage is offered with "n of N"; tasks it is not a valid step for are skipped and the reason is reported; a revision asks once for the note all of them get; failures go back individually and the list reloads.
* **Optimistic, with rollback**: a move shows at once in the row and the panel (including the revision number) and is put back if the database refuses.

Unchanged from Phase 6 and still covered by tests: inline people, dates, priority and rename, search, filters, grouping, sorting, selection, bulk edits, keyboard, detail navigation, mobile layout.

## 7. Deliberately deferred

* Activity feed / full history UI, comments, mentions, notifications: Phase 10 (built on `task_status_events`).
* A workflow editor UI and per-list workflows: later (the data model supports more workflows; the app reads the workspace default).
* `completed_at` / cycle-time analytics: Phase 11 reporting (derivable from the history).
* Board / Table views: Phase 8.
* Client sign-off by Client Viewers: they have no task access yet (guest grants are a later phase).

## 8. Employee production analytics: "videos first submitted for QC" (migration 9)

### The metric, and what it is not

An editor earns **one production credit** the first time a task reaches **QC - FIRST APPROVAL**. That moment means "the editor finished the editing and submitted the video for its first QC review", and it is the only thing counted. It is **not** delivery, approval or closing: a video may sit in QC, revision or client review for weeks after the editor's work is done, and none of that moves the credit. A video submitted in January and delivered in April is a **January** video.

Wording is consistent everywhere (database, code, UI, tests): *"videos first submitted for QC"*, never "delivered".

### Immutable attribution

`task_production_credits (task_id PK, workspace_id, editor_id, first_qc_submitted_at, submitted_by, created_at)`, written only by the `record_production_credit` trigger (AFTER INSERT/UPDATE OF status on `tasks`) when a task enters a stage flagged `workflow_statuses.credits_production` (QC - FIRST APPROVAL; at most one such stage per workflow):

* `editor_id` is the editor **assigned at that moment**, taken at write time; the task's current assignee is never consulted again.
* `task_id` is the primary key and the insert uses `ON CONFLICT DO NOTHING`: a revision cycle, "withdraw from QC", an admin override back to editing, a different editor re-submitting, any number of later entries into QC - FIRST APPROVAL: **no second credit**, the first editor and the first timestamp stay.
* Reassignment before first QC: the editor who submits it earns it, the earlier one gets nothing. Reassignment after: the original editor keeps it.
* Permanent: no INSERT/UPDATE/DELETE privilege or policy for the API; a trigger refuses UPDATE and direct DELETE even for the service role; the FK to `tasks` has no cascade, so **a credited task cannot be deleted** (the UI explains why). Only deleting the whole workspace removes credits.
* Read access: Owner and Admin only (RLS `is_workspace_admin`). Nobody else (Production Manager, QC, editors, clients, anonymous) can read the table or call the functions.
* The credit holds only who / which task / when. Title, list, links and stage are always the **task's own** fields: there are no analytics-only video records.
* **No backfill**: a task already past first QC has no recorded first-submission time or editor (production had none when this shipped), so credits start with the migration. Inventing history was rejected.

### Reading

Two SECURITY INVOKER functions (RLS applies to the caller, and each re-checks Owner/Admin): `production_monthly(workspace, timezone)` (credits per editor per calendar month) and `production_videos(workspace, editor, year, month, timezone)` (the real tasks behind a month, newest first, with space / folder / list names and the review, project-file and final-export links). Months are calendar months in the viewer's time zone (`profiles.timezone`), so 23:30 UTC on 31 March counts as April in Dhaka.

### Interface (`/production`, Owner / Admin only; sidebar "Production")

* Employee list: every current editor (even with nothing yet) plus anyone with credits (people who left keep their history), searchable; this month, this year, all time and a six-month sparkline per person; team total this month.
* Selecting an employee shows three figures (this month / year / all time), a year switcher and a twelve-month bar chart that is also the month picker. Hovering or focusing a bar says "October 2026 - 24 videos first submitted for QC"; future months are disabled.
* Selecting a month lists the videos: title (opens the real task), first-QC date and time, space / folder / list, the task's current stage, and "Edited video" (the task's review link), project file and final export links (only valid http(s) links are links). Employee, year and month live in the URL (shareable, back button works). Mobile: list, then detail with a back button.
* Caveat shown in the UI: stage and links are the task's values *today*; the date is the permanent first-QC moment. The "Edited video" link is the task's current review link, which an editor may have replaced on a later resubmission.

### Tests for the thirteen required cases

Offline RLS suite (section "Phase 7b", 44 checks) and live suite section: first submission +1; two months to final approval stays in the first-QC month; reassignment before (new editor +1, old +0) and after (original keeps it); revision cycle; repeated first-QC transitions (including override and withdraw paths); several videos in a month; several years and time zones; task ids and review links in the month list; Owner/Admin only for the functions *and* the table (PM, QC, editor, client, stranger, anon denied); no write path for anyone, including the service role; credited task undeletable; credits survive deactivation. Unit tests cover grouping, summaries, ordering, URL parsing and wording; the page tests cover access, the list, the chart labels, the month list and links.

## 9. Verification

* **Unit / component** (`npm test`): 626 tests, 33 files, about 98.5% line coverage. New: `lib/workflow.test.ts` (fixture-vs-migration drift check, canonical order, requirements, every role x every edge, revision cycle, overrides, bulk verdicts, waiting hint), `database/workflow-data.test.ts`, and picker / dialog / detail panel / bulk / rollback / stale / revision tests in `task-list` and `task-detail`.
* **Offline RLS** (`npm run test:db`): 428 checks, 87 in the Phase 7 section (configuration access, creation rules, every edge per role, requirements, revision counting and tamper-proofing, stale moves, overrides, direct `PATCH` bypass, outsiders, append-only history, security posture).
* **Live** (`npm run test:live` against the real project, temporary `@tbb-e2e.invalid` users, cleaned up and verified): see the commit for the result; the suite compares task, history and workflow table counts before and after so production data is provably untouched.
* **Browser** (temporary harness, not committed): desktop 1440 / 1280 / 1024, tablet 800, mobile 375, light and dark. Found and fixed: a picker or bulk menu that opens a dialog must not return focus to its trigger (Radix would close the dialog at once); stage pills truncate with a tooltip in the 1024–1279 px range, titles wrap to two lines there, and the inline link icons move to the panel only in that range.

# Phase 12b: task batches

In TBB's real ClickUp a "batch" task (for example "CONNECTORS CAN | MEDICUS ELITE") has about ten child
tasks, each one video with its own editor, status, priority and dates. A TBB task is already one video
deliverable, so a batch is a task that other tasks point to. The videos are full tasks: own workflow status,
editor and QC reviewer, production credit.

Migration: `supabase/migrations/20260930000018_task_batches.sql`.

## Model

- `tasks.parent_id` (nullable, `ON DELETE SET NULL`, indexed where not null). A task with no parent is an
  ordinary task or a batch.
- Deleting a batch never deletes its videos (credited tasks cannot be deleted): they become ordinary tasks.
  Deleting a video leaves the batch.

## Rules (enforced by `trg_tasks_z_parent_guard`, whatever the client sends)

- One level only: a batch cannot be a video, and a task that has videos cannot become one.
- A video is in the same list (and so the same workspace) as its batch; a batch with videos and a video
  cannot be moved to another list.
- A task cannot be its own batch.
- `parent_id` is set only at creation, through `create_batch_video`. Nobody (not even the Owner) can set,
  change or clear it with a direct insert or update; the only other change is the foreign key nulling it when
  the batch is deleted.

## Permissions

- `create_batch_video(p_parent_id, p_title, p_editor_id, p_qc_id)` is SECURITY INVOKER and reuses
  `create_task`, so the same people may call it: Owner, Admin, Production Manager. Editors, QC, client
  viewers and anon are refused.
- `batch_progress(p_parent_ids)` is SECURITY INVOKER: row security decides which videos are counted, so
  people see only what they can read. Finished means the video's status is in the COMPLETED category of the
  workspace's default workflow. At most 500 ids per call. Not executable by anon.
- The service role is not restricted by the "set only at creation" rule (admin repair), but the structural
  rules still apply.

## App

Data: `src/database/batches.ts` (`listBatchVideos`, `createBatchVideo`, `getBatchProgress`). Hooks:
`src/hooks/use-batches.ts` (cached under the workspace's `tasks` prefix). UI: the "Videos" section of the
task detail sheet (`BatchVideosSection`): progress ("3 of 10 videos finished"), the videos with stage, editor
and due date, and an "Add video" input for roles that can create tasks. A video shows "Part of <batch>".
The section is hidden for a task with no videos when the person cannot add any.

## Known limitations

- The list, board and table views do not nest videos under their batch or show the parent yet.
- Search rows (`search_tasks`) and `TaskSummary` do not carry `parent_id`.
- A video cannot be moved to another batch or detached in the app; deleting the batch detaches all of them.
- New videos get only a title (plus editor and QC through the RPC); other fields are edited in the video's own sheet.
- Videos are listed up to 200 per batch.

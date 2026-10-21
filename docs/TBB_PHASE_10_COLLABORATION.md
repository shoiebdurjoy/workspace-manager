# TBB Workspace V2 — Phase 10: Comments, Attachments, Activity and Notifications
**Document ID:** `docs/TBB_PHASE_10_COLLABORATION.md`
**Roadmap reference:** `docs/TBB_15_PHASE_ROADMAP.md` Phase 10
**Status:** Implemented (migrations `…000012_task_comments`, `…000013_task_attachments`, `…000014_activity_and_notifications`)

---

## 1. Principle: everything on screen is a row the database wrote

There is no demo data, no placeholder feed and no client-side bookkeeping. A comment is a `task_comments` row; a file is a stored object **and** a `task_attachments` row; an activity line is a `task_activity` / `task_status_events` row written by a trigger in the same transaction as the event; a notification is a `notifications` row created by a trigger for a person who can see the task. The interface only reads them (and, for comments, files and read-state, writes through RLS).

Who can see and write what is decided by RLS, guard triggers and storage policies. The interface hides what a role cannot do, but hiding is never the control.

| | Read | Write |
| :--- | :--- | :--- |
| Comments | any staff member of the workspace | staff: post; **author only** edits; author or Owner/Admin deletes |
| Attachments | any staff member (through a signed link) | Owner/Admin/Production Manager/QC on any task, an **Editor on tasks assigned to them**; the uploader or any manager deletes |
| Activity | any staff member | nobody (database triggers only) |
| Notifications | **the recipient only** | nobody creates; the recipient changes only `read_at` |

Client viewers have no task access yet (the same fail-closed rule as the rest of the task model), so they have none of these either.

## 2. Comments and @mentions (migration 12)

- `task_comments(id, task_id, workspace_id, author_id, body, mentions, created_at, updated_at, edited_at)`.
- `guard_task_comment` (BEFORE INSERT/UPDATE) is the only authority on derived fields: the **workspace comes from the task**, the **author is always `auth.uid()`** (a forged `author_id` is overwritten), timestamps are the server's, `edited_at` is set when the text changes, and **`mentions` is recomputed from the text**.
- A mention is written into the text as `@[Name](user-id)`. The database reads those tokens and keeps only people it can verify: an **active staff member of this workspace**. A token for a client viewer, a stranger, a made-up id or a deactivated account is plain text. The client can never claim to have mentioned someone (a supplied `mentions` array is ignored), and a mention can never reach outside the workspace. At most 50 tokens are read and 20 people kept.
- Only the `body` column is updatable (`GRANT UPDATE (body)`); `task_id`, `workspace_id`, `author_id`, `created_at` are immutable (trigger), so a comment can never be re-attributed or moved.
- Deleting an account keeps its comments (`author_id` becomes null, shown as "Former member"): the FK `ON DELETE SET NULL` update is the single change the guard allows besides an edit, and only once the profile is really gone.
- Interface: threaded-less conversation (oldest first, composer at the bottom), posting is optimistic and rolls back with the text restored and the reason shown, edit in place, delete with confirmation, `@` opens a picker (arrow keys, Enter, Escape, mouse) listing only mentionable staff. Comment text is rendered as text: mentions become chips, `http(s)` links become safe links (`rel="noopener noreferrer"`), nothing is ever rendered as HTML.

## 3. Attachments and private storage (migration 13)

- **Bucket** `task-attachments`: private (`public = false`), 25 MB per file, an explicit MIME allow-list (images except SVG, PDF, text/CSV/Markdown, Word/Excel/PowerPoint, audio, zip). No HTML, no SVG (script), no executables. There is no public URL, ever.
- **Path** `<workspace-id>/<task-id>/<attachment-id>/<file>`: lower-case UUIDs and a plain `[A-Za-z0-9._-]` file name. The storage policies parse the path, so a person can only put a file where they may attach one; a path that does not match the shape is refused.
- **Upload policy:** `private.can_attach(path)` (manager/QC on any task, assigned editor on theirs). **No UPDATE policy**: an object can never be overwritten or renamed (even `x-upsert: true` is refused).
- **Read policy:** staff, but **only for a file that has a record**; a file uploaded and never recorded is visible to its uploader and managers only, so an abandoned upload is not a leak. Opening a file means asking Storage for a **60-second signed URL**, which Storage only creates when the policy allows reading that object.
- **Record** `task_attachments`: `guard_task_attachment` requires the object to **exist** at the path its own ids imply and **reads size and MIME type back from what Storage stored** (the client's claims are replaced), then the table's `CHECK`s (allow-listed type, `0 < size ≤ 25 MB`, a display name without `/`, `\` or control characters) apply. A stored HTML file or one over 25 MB therefore can never get a record. Records cannot be edited (no UPDATE grant; the trigger refuses it).
- **Delete:** the record first (it is what everyone sees), then the stored object. Both are allowed to the uploader and to any manager, and to nobody else.
- **Interface:** drop zone / chooser (multiple files), validation with a readable message **before** any byte is sent, real progress (an `XMLHttpRequest` upload; `fetch` has no upload progress), cancel, per-file errors, open / download through signed links, delete with confirmation. Deleting a **task** first reads its file paths, deletes the task, then removes the objects (the records cascade away with it).

## 4. Activity (migration 14)

`task_activity(task_id, workspace_id, actor_id, kind, data, created_at)` is written by `SECURITY DEFINER` triggers and has **no INSERT / UPDATE / DELETE grant for anyone**: no one can fabricate or erase history.

| Event | Trigger | Entry |
| :--- | :--- | :--- |
| Task created | `tasks` AFTER INSERT | `created` |
| Property changed | `tasks` AFTER UPDATE | one `updated` entry listing changes: small values as from → to (title, priority, dates, aspect ratio, list); long text and links only as "changed" (their content is never copied) |
| Assigned / removed | `task_assignees` | `assigned` / `unassigned` (with role and person) |
| Comment posted | `task_comments` AFTER INSERT | `commented` (edits are not new events) |
| File attached / removed | `task_attachments` | `attachment_added` / `attachment_removed` (name, size) |
| Stage changed | already `task_status_events` (migration 8) | **read from there, not copied**: the feed merges both sources by time |

**No back-fill.** Before this migration nothing was recorded and nothing is invented; a task shows only what really happened since. Saves that change nothing, and changes nobody would call an edit (position), write nothing. Deleting a task or workspace cascades the entries away without tripping the triggers (`private.log_activity` skips a task or workspace that is already gone).

## 5. Notifications (migration 14)

`notifications(user_id, workspace_id, task_id, actor_id, kind, data, dedupe_key, read_at, created_at)` with **`UNIQUE (user_id, dedupe_key)`**: one row per person per event, so a retry, an edit or a re-run can never notify twice.

| Kind | Who is notified | When |
| :--- | :--- | :--- |
| `mention` | each verified mentioned person | a comment is posted **or edited** to include them (once per comment) |
| `comment` | the task's editor and QC reviewer, unless mentioned (the mention is the better notice) | a new comment |
| `assigned` | the person assigned | assigned as editor / QC reviewer (the time is part of the key, so being re-assigned later is a new event) |
| `status` | the task's editor and QC reviewer | the task moves to another stage (not the first history row, which is the creation) |

Never to **the person who caused the event**, never to someone who is **not an active staff member of that workspace** (so a client, a stranger, a deactivated account cannot be notified), and never for a task of another workspace (`private.notify` re-checks).

- **Reading:** a policy of `user_id = auth.uid()` **and** current membership (so someone removed from the workspace stops seeing what they were sent). Not even an Owner can read a colleague's.
- **Writing:** none, except `GRANT UPDATE (read_at)`; `guard_notification` forces the server's time, keeps the first read time, and refuses any other change. Mark read / unread / all read.
- **Deep links:** `/tasks/<task-id>?tab=comments&comment=<comment-id>` (or `?tab=activity`). Only ids go into the address; `/tasks/:id` resolves the task's list and forwards **keeping the query**, the sheet opens on the right tab, scrolls to the comment and marks it for a moment.
- **Realtime:** `notifications` is added to the `supabase_realtime` publication (guarded: skipped on a plain Postgres). Realtime applies the table's RLS, so a person only ever receives their own rows. The bell also refetches on window focus and polls the (tiny) unread count every 60 s as the fallback when the live connection is down.
- **Interface:** a bell in the app header with an unread badge (`99+` cap, in the accessible name), a panel with All / Unread, "Mark all read", per-row read / unread, keyset paging ("Load older"), empty / error / loading states. Opening a notification marks it read optimistically (rolled back on failure) and navigates.

## 6. Security verification

- **RLS everywhere**, no policy weakened. Offline suite: *Phase 10* section (≈200 checks) covering every role against all four tables, forged authors/workspaces/mentions, cross-workspace attempts, direct-API bypass attempts (`INSERT` into activity/notifications, `UPDATE` of immutable columns, calling the trigger / writer functions), cascades (task, workspace, account deletion), grants (no `anon`, no `TRUNCATE`), initplan-form policies, index presence.
- **Storage policies** are exercised offline against a storage stand-in and **live** against the real bucket: upload per role, wrong workspace / task / path shapes, forbidden types, > 25 MB, overwrite / upsert, signed-link access per role, public / unauthenticated URLs refused, orphan uploads, deletion per role, and that deleted files are really gone.
- **No secrets in the client:** only the public anon key is used; uploads send the person's own access token.
- **Production safety:** the live suite counts comments, attachments, activity, notifications and stored files **before and after** and fails if production's own numbers changed; it removes the files it stored through the Storage API.

## 7. Known limitations

- **Due-date reminders are not built.** They need a scheduler (pg_cron / an Edge Function) that nothing in this project runs yet; no fake reminders are shown.
- **Comments are not threaded** (a single chronological conversation) and have no reactions; comment edits keep no history.
- **Comment polling:** comments refresh every 30 s while the sheet is open and on focus; only notifications are pushed live.
- **Files orphaned by a deletion that bypasses the app** (deleting a list, folder or space cascades to tasks and their records, but Storage objects are removed only by the application's own task deletion) remain in the bucket, invisible to everyone except managers and their uploaders. They can be found with `select name from storage.objects where bucket_id = 'task-attachments' and not exists (select 1 from public.task_attachments a where a.storage_path = name)` and removed through the Storage API.
- **No image previews/thumbnails** (files are opened or downloaded through signed links).
- Notification e-mail / push is out of scope (in-app only).
- A mention token is plain text in the stored `body`; it is rendered with the name written at the time (a later rename shows the old name in old comments, the link to the person is the id).

## 8. Tests
Unit: `lib/__tests__/collaboration.test.ts` (mention tokens and caret logic, file validation, storage names and paths, activity and notification sentences, permissions), `database/__tests__/collaboration-data.test.ts` (every query, the upload request, signed URLs, keyset paging, realtime channel), `components/collaboration/__tests__/collaboration.test.tsx` (comments incl. optimistic rollback, the mention picker, edit/delete rules per role, files incl. progress / validation / signed open, activity, URL tabs, the bell incl. badge, mark read, paging, realtime refresh, client viewers). Database: the *Phase 10* section of `supabase/tests/rls-check.mjs` and of `supabase/tests/live-rls-e2e.mjs`.

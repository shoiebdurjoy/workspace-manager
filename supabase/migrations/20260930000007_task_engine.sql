-- ==============================================================================
-- Migration: 20260930000007_task_engine.sql
-- Phase 6 — Task Engine & video deliverable metadata
--
-- What already existed (migrations 1-4) and is reused unchanged: `tasks` and `subtasks`
-- (hierarchy parent -> subtask is a separate table, one level only, exactly as the roadmap
-- specifies), their workspace-derivation triggers, indexes, RLS policies and grants.
-- Task `status` stays the generic CHECK list from migration 1: the configurable TBB workflow
-- (TO BE EDITED ... CLOSED, revision counter, QC gating) is Phase 7 and replaces it there.
--
-- This migration adds only what Phase 6 needs:
--
--  1. Video deliverable columns on `tasks`: aspect_ratio, four link fields (raw footage,
--     project file, review, final export) and client_deadline. `due_date` already exists and
--     is the INTERNAL QC due date. All are validated by CHECK constraints so a malformed value
--     (e.g. a `javascript:` URL) can never be stored and later rendered as a link.
--  2. `task_assignees` (roadmap Phase 6): one EDITOR and one QC_REVIEWER per task. The
--     primary key (task_id, role_type) enforces "one of each"; widening to several people per
--     role later is a primary-key change, not a redesign. A trigger derives workspace_id and
--     assigned_by, and refuses assignees who are not eligible:
--        EDITOR       -> workspace Owner / Admin / Production Manager / Editor
--        QC_REVIEWER  -> workspace Owner / Admin / Production Manager / QC Specialist
--        and the same person can never hold both roles on one task (nobody QC's their own cut).
--  3. Guard triggers tightened, as migration 1 promised ("Phase 6 adds assignees; tighten
--     then") and docs/TBB_PERMISSION_MODEL.md 3 requires ("Editors have write access to
--     operational fields only on tasks assigned to them"):
--        EDITOR : status, position, review_link, project_file_link  — ONLY on tasks assigned to them
--        QC     : status, position (unchanged)
--        Subtasks: an EDITOR can tick/reorder only subtasks of tasks assigned to them.
--     Before this migration any editor could change the status of ANY task.
--  4. Three SECURITY INVOKER functions (every row is still checked by the caller's own RLS and
--     guards, so they grant nothing a plain INSERT/UPDATE could not):
--        create_task()        task + assignees in ONE transaction, position appended under a
--                             per-list advisory lock (no duplicate positions under concurrency)
--        set_task_assignee()  replace or clear one assignee atomically
--        move_task()          move one task up/down one place; re-sequences the list densely
--
-- The live project has no tasks yet; the new CHECK constraints cannot be violated by existing rows.
--
-- Rollback (in this order):
--   DROP FUNCTION public.create_task(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID);
--   DROP FUNCTION public.set_task_assignee(UUID, TEXT, UUID);
--   DROP FUNCTION public.move_task(UUID, TEXT);
--   DROP TABLE public.task_assignees;  DROP FUNCTION public.guard_task_assignee();
--   ALTER TABLE public.tasks DROP COLUMN aspect_ratio, DROP COLUMN raw_footage_link, DROP COLUMN project_file_link,
--     DROP COLUMN review_link, DROP COLUMN final_export_link, DROP COLUMN client_deadline;
--   (and restore guard_task_update / guard_subtask_update from migration 4)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Deliverable columns
-- ------------------------------------------------------------------------------

ALTER TABLE public.tasks
  ADD COLUMN aspect_ratio VARCHAR(10),
  ADD COLUMN raw_footage_link TEXT,
  ADD COLUMN project_file_link TEXT,
  ADD COLUMN review_link TEXT,
  ADD COLUMN final_export_link TEXT,
  ADD COLUMN client_deadline TIMESTAMPTZ;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_aspect_ratio_valid
    CHECK (aspect_ratio IS NULL OR aspect_ratio IN ('9:16', '16:9', '1:1', '4:5', 'OTHER')),
  ADD CONSTRAINT tasks_raw_footage_link_url
    CHECK (raw_footage_link IS NULL OR (length(raw_footage_link) <= 2048
      AND raw_footage_link ~* '^https?://[^[:space:]/?#]+([/?#][^[:space:]]*)?$')),
  ADD CONSTRAINT tasks_project_file_link_url
    CHECK (project_file_link IS NULL OR (length(project_file_link) <= 2048
      AND project_file_link ~* '^https?://[^[:space:]/?#]+([/?#][^[:space:]]*)?$')),
  ADD CONSTRAINT tasks_review_link_url
    CHECK (review_link IS NULL OR (length(review_link) <= 2048
      AND review_link ~* '^https?://[^[:space:]/?#]+([/?#][^[:space:]]*)?$')),
  ADD CONSTRAINT tasks_final_export_link_url
    CHECK (final_export_link IS NULL OR (length(final_export_link) <= 2048
      AND final_export_link ~* '^https?://[^[:space:]/?#]+([/?#][^[:space:]]*)?$')),
  ADD CONSTRAINT tasks_description_length
    CHECK (description IS NULL OR char_length(description) <= 20000);

-- ------------------------------------------------------------------------------
-- 2. task_assignees
-- ------------------------------------------------------------------------------

CREATE TABLE public.task_assignees (
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  role_type VARCHAR(20) NOT NULL CHECK (role_type IN ('EDITOR', 'QC_REVIEWER')),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, role_type)
);

-- "My tasks" (Phase 11) and "is this person assigned" checks
CREATE INDEX idx_task_assignees_user ON public.task_assignees(user_id, role_type, task_id);
CREATE INDEX idx_task_assignees_workspace ON public.task_assignees(workspace_id);

CREATE OR REPLACE FUNCTION public.guard_task_assignee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ws UUID;
  member_role TEXT;
  acct_active BOOLEAN;
  other_user UUID;
BEGIN
  SELECT workspace_id INTO ws FROM public.tasks WHERE id = NEW.task_id;
  IF ws IS NULL THEN
    RAISE EXCEPTION 'task % does not exist', NEW.task_id USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'UPDATE' AND (NEW.task_id IS DISTINCT FROM OLD.task_id
                           OR NEW.role_type IS DISTINCT FROM OLD.role_type) THEN
    RAISE EXCEPTION 'an assignment cannot be moved to another task or role' USING ERRCODE = '42501';
  END IF;

  NEW.workspace_id := ws;
  IF auth.uid() IS NOT NULL THEN
    NEW.assigned_by := auth.uid();
  END IF;
  IF TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    NEW.assigned_at := NOW();
  END IF;

  SELECT m.role::text, p.is_active INTO member_role, acct_active
  FROM public.workspace_members m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.workspace_id = ws AND m.user_id = NEW.user_id;

  IF member_role IS NULL THEN
    RAISE EXCEPTION 'only members of this workspace can be assigned to a task' USING ERRCODE = '23514';
  END IF;
  IF NOT acct_active THEN
    RAISE EXCEPTION 'a deactivated account cannot be assigned to a task' USING ERRCODE = '23514';
  END IF;
  IF NEW.role_type = 'EDITOR' AND member_role NOT IN ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'EDITOR') THEN
    RAISE EXCEPTION 'only editors and managers can be assigned to edit a video' USING ERRCODE = '23514';
  END IF;
  IF NEW.role_type = 'QC_REVIEWER' AND member_role NOT IN ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST') THEN
    RAISE EXCEPTION 'only QC specialists and managers can be assigned as QC reviewer' USING ERRCODE = '23514';
  END IF;

  -- Separation of duties: the person editing a video does not also QC it.
  SELECT a.user_id INTO other_user
  FROM public.task_assignees a
  WHERE a.task_id = NEW.task_id AND a.role_type <> NEW.role_type;
  IF other_user IS NOT NULL AND other_user = NEW.user_id THEN
    RAISE EXCEPTION 'the same person cannot be both the editor and the QC reviewer of a task'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_assignees_guard ON public.task_assignees;
CREATE TRIGGER trg_task_assignees_guard BEFORE INSERT OR UPDATE ON public.task_assignees
  FOR EACH ROW EXECUTE FUNCTION public.guard_task_assignee();

ALTER TABLE public.task_assignees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_assignees_select"
  ON public.task_assignees FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id));

CREATE POLICY "task_assignees_insert"
  ON public.task_assignees FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_manager(workspace_id));

CREATE POLICY "task_assignees_update"
  ON public.task_assignees FOR UPDATE TO authenticated
  USING (private.is_workspace_manager(workspace_id))
  WITH CHECK (private.is_workspace_manager(workspace_id));

CREATE POLICY "task_assignees_delete"
  ON public.task_assignees FOR DELETE TO authenticated
  USING (private.is_workspace_manager(workspace_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.task_assignees TO authenticated;
GRANT ALL ON TABLE public.task_assignees TO service_role;
REVOKE ALL ON TABLE public.task_assignees FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.task_assignees FROM authenticated;
REVOKE ALL ON FUNCTION public.guard_task_assignee() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. Guard triggers: editors act only on tasks assigned to them
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_task_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r TEXT;
  late TEXT[] := ARRAY['READY_TO_DELIVER', 'CLIENT_REVIEW', 'COMPLETED', 'CLOSED'];
  allowed TEXT[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  r := private.workspace_role(OLD.workspace_id);

  IF r IN ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER') THEN
    RETURN NEW;
  END IF;

  IF r = 'QC_SPECIALIST' THEN
    allowed := ARRAY['status', 'position', 'updated_at'];
  ELSIF r = 'EDITOR' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.task_assignees a
      WHERE a.task_id = OLD.id AND a.role_type = 'EDITOR' AND a.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'editors can only update tasks that are assigned to them'
        USING ERRCODE = '42501';
    END IF;
    allowed := ARRAY['status', 'position', 'review_link', 'project_file_link', 'updated_at'];
  ELSE
    RAISE EXCEPTION 'your role cannot modify tasks' USING ERRCODE = '42501';
  END IF;

  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'your role may only change %', array_to_string(allowed[1:cardinality(allowed) - 1], ', ')
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF r = 'QC_SPECIALIST'
       AND (NEW.status IN ('COMPLETED', 'CLOSED') OR OLD.status IN ('COMPLETED', 'CLOSED')) THEN
      RAISE EXCEPTION 'QC specialists cannot complete, close or reopen tasks'
        USING ERRCODE = '42501';
    END IF;
    IF r = 'EDITOR' AND (NEW.status = ANY (late) OR OLD.status = ANY (late)) THEN
      RAISE EXCEPTION 'editors cannot move tasks into or out of QC-approved and later stages'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_subtask_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  r := private.workspace_role(OLD.workspace_id);

  IF r IN ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER') THEN
    RETURN NEW;
  END IF;

  IF r IN ('QC_SPECIALIST', 'EDITOR') THEN
    IF r = 'EDITOR' AND NOT EXISTS (
      SELECT 1 FROM public.task_assignees a
      WHERE a.task_id = OLD.task_id AND a.role_type = 'EDITOR' AND a.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'editors can only tick subtasks of tasks that are assigned to them'
        USING ERRCODE = '42501';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['is_completed', 'position', 'updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['is_completed', 'position', 'updated_at']) THEN
      RAISE EXCEPTION 'your role may only tick or reorder subtasks'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'your role cannot modify subtasks' USING ERRCODE = '42501';
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Atomic operations (SECURITY INVOKER: the caller's RLS and guards still apply)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_task(
  p_list_id UUID,
  p_title TEXT,
  p_description TEXT DEFAULT NULL,
  p_priority TEXT DEFAULT 'MEDIUM',
  p_aspect_ratio TEXT DEFAULT NULL,
  p_raw_footage_link TEXT DEFAULT NULL,
  p_project_file_link TEXT DEFAULT NULL,
  p_review_link TEXT DEFAULT NULL,
  p_final_export_link TEXT DEFAULT NULL,
  p_due_date TIMESTAMPTZ DEFAULT NULL,
  p_client_deadline TIMESTAMPTZ DEFAULT NULL,
  p_editor_id UUID DEFAULT NULL,
  p_qc_id UUID DEFAULT NULL
)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  next_pos INTEGER;
  created public.tasks;
BEGIN
  -- Serialise appends per list so two people adding at once never share a position.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_list_id::text, 0));
  SELECT COALESCE(MAX(t.position), -1) + 1 INTO next_pos FROM public.tasks t WHERE t.list_id = p_list_id;

  INSERT INTO public.tasks (
    list_id, title, description, priority, aspect_ratio, raw_footage_link, project_file_link,
    review_link, final_export_link, due_date, client_deadline, position
  ) VALUES (
    p_list_id, btrim(p_title), NULLIF(btrim(COALESCE(p_description, '')), ''),
    COALESCE(p_priority, 'MEDIUM'), p_aspect_ratio, p_raw_footage_link, p_project_file_link,
    p_review_link, p_final_export_link, p_due_date, p_client_deadline, next_pos
  )
  RETURNING * INTO created;

  IF p_editor_id IS NOT NULL THEN
    INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES (created.id, 'EDITOR', p_editor_id);
  END IF;
  IF p_qc_id IS NOT NULL THEN
    INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES (created.id, 'QC_REVIEWER', p_qc_id);
  END IF;

  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_task_assignee(p_task_id UUID, p_role_type TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  removed INTEGER;
BEGIN
  IF p_role_type IS NULL OR p_role_type NOT IN ('EDITOR', 'QC_REVIEWER') THEN
    RAISE EXCEPTION 'set_task_assignee: role must be EDITOR or QC_REVIEWER' USING ERRCODE = '22023';
  END IF;

  IF p_user_id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = p_task_id AND a.role_type = p_role_type) THEN
      RETURN;
    END IF;
    DELETE FROM public.task_assignees a WHERE a.task_id = p_task_id AND a.role_type = p_role_type;
    GET DIAGNOSTICS removed = ROW_COUNT;
    IF removed = 0 THEN
      RAISE EXCEPTION 'you do not have permission to change this assignment' USING ERRCODE = '42501';
    END IF;
    RETURN;
  END IF;

  INSERT INTO public.task_assignees (task_id, role_type, user_id)
  VALUES (p_task_id, p_role_type, p_user_id)
  ON CONFLICT (task_id, role_type) DO UPDATE SET user_id = EXCLUDED.user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_task(p_task_id UUID, p_direction TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  the_list UUID;
  step INTEGER;
  my_rank INTEGER;
  total INTEGER;
  expected INTEGER;
  changed INTEGER;
BEGIN
  IF p_direction IS NULL OR p_direction NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'move_task: direction must be up or down' USING ERRCODE = '22023';
  END IF;
  step := CASE WHEN p_direction = 'up' THEN -1 ELSE 1 END;

  SELECT t.list_id INTO the_list FROM public.tasks t WHERE t.id = p_task_id;
  IF the_list IS NULL THEN
    RAISE EXCEPTION 'task not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(the_list::text, 0));

  -- Where is the task in the list's display order, and is there a neighbour that way?
  SELECT q.rn, q.total INTO my_rank, total
  FROM (
    SELECT t.id,
           (row_number() OVER (ORDER BY t.position, t.created_at, t.id) - 1)::INTEGER AS rn,
           (count(*) OVER ())::INTEGER AS total
    FROM public.tasks t WHERE t.list_id = the_list
  ) q WHERE q.id = p_task_id;
  IF my_rank + step < 0 OR my_rank + step >= total THEN
    RETURN FALSE; -- already first / last
  END IF;

  -- Dense re-sequencing in the current display order with the task and its neighbour
  -- swapped. Only rows whose position actually changes are written.
  WITH ranked AS (
    SELECT t.id, (row_number() OVER (ORDER BY t.position, t.created_at, t.id) - 1)::INTEGER AS rn
    FROM public.tasks t WHERE t.list_id = the_list
  ), me AS (
    SELECT r.rn FROM ranked r WHERE r.id = p_task_id
  ), tgt AS (
    SELECT r.id, r.rn FROM ranked r, me WHERE r.rn = me.rn + step
  ), planned AS (
    SELECT r.id,
           CASE WHEN r.id = p_task_id THEN (SELECT rn FROM tgt)
                WHEN r.id = (SELECT id FROM tgt) THEN (SELECT rn FROM me)
                ELSE r.rn END AS new_pos
    FROM ranked r
  )
  SELECT count(*)::INTEGER INTO expected
  FROM planned p JOIN public.tasks t ON t.id = p.id WHERE t.position IS DISTINCT FROM p.new_pos;

  WITH ranked AS (
    SELECT t.id, (row_number() OVER (ORDER BY t.position, t.created_at, t.id) - 1)::INTEGER AS rn
    FROM public.tasks t WHERE t.list_id = the_list
  ), me AS (
    SELECT r.rn FROM ranked r WHERE r.id = p_task_id
  ), tgt AS (
    SELECT r.id, r.rn FROM ranked r, me WHERE r.rn = me.rn + step
  ), planned AS (
    SELECT r.id,
           CASE WHEN r.id = p_task_id THEN (SELECT rn FROM tgt)
                WHEN r.id = (SELECT id FROM tgt) THEN (SELECT rn FROM me)
                ELSE r.rn END AS new_pos
    FROM ranked r
  )
  UPDATE public.tasks t SET position = p.new_pos
  FROM planned p WHERE t.id = p.id AND t.position IS DISTINCT FROM p.new_pos;
  GET DIAGNOSTICS changed = ROW_COUNT;

  -- RLS silently skips rows the caller may not update. Refuse partial results.
  IF changed <> expected THEN
    RAISE EXCEPTION 'you do not have permission to reorder these tasks' USING ERRCODE = '42501';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION
  public.create_task(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID),
  public.set_task_assignee(UUID, TEXT, UUID),
  public.move_task(UUID, TEXT)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.create_task(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID),
  public.set_task_assignee(UUID, TEXT, UUID),
  public.move_task(UUID, TEXT)
TO authenticated;

-- ==============================================================================
-- Migration 18: task batches (Phase 12, second slice)
-- ==============================================================================
-- In TBB's real work a "batch" (e.g. "CONNECTORS CAN | MEDICUS ELITE") is ~10 videos, each with its own
-- editor, status, priority and dates. A task is already ONE video deliverable, so a batch is simply a
-- task that other tasks point to. The children are FULL tasks: own workflow status, assignees, credit.
--
--   * tasks.parent_id: NULL for an ordinary task or a batch, the batch task for a video.
--     ON DELETE SET NULL, never CASCADE: credited tasks cannot be deleted, so deleting a batch must not
--     take its videos with it. The videos simply become ordinary tasks again.
--   * One level only (a batch cannot itself be a video; a task that has videos cannot become one), a video
--     lives in the SAME list (hence workspace) as its batch, and nothing is its own parent. Moving a
--     batch or a video to another list is refused for the same reason.
--   * parent_id is set ONLY at creation, through create_batch_video(). No role can write it directly
--     (not even the Owner): trg_tasks_z_parent_guard refuses every insert/update of it that did not come
--     from the private helper. The one other change is the foreign key nulling it when the batch is deleted.
--   * create_batch_video() = create_task() (same permissions: the managers) + the controlled attach.
--   * batch_progress(): how many videos each batch has and how many are finished (status category
--     COMPLETED in the workspace's default workflow). SECURITY INVOKER: row security decides what counts.
--
-- The activity trigger and search_tasks are untouched; search rows do not carry parent_id.
--
-- Rollback (the videos stay, as ordinary tasks):
--   DROP FUNCTION public.batch_progress(UUID[]); DROP FUNCTION public.create_batch_video(UUID, TEXT, UUID, UUID);
--   DROP FUNCTION private.attach_batch_parent(UUID, UUID);
--   DROP TRIGGER trg_tasks_z_parent_guard ON public.tasks; DROP FUNCTION public.guard_task_parent();
--   ALTER TABLE public.tasks DROP COLUMN parent_id;
-- ==============================================================================

ALTER TABLE public.tasks ADD COLUMN parent_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL;
CREATE INDEX idx_tasks_parent ON public.tasks(parent_id) WHERE parent_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 1. Guard (a new trigger: the existing task guards are untouched)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_task_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.tasks;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.list_id IS DISTINCT FROM OLD.list_id
       AND (OLD.parent_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.tasks c WHERE c.parent_id = OLD.id)) THEN
      RAISE EXCEPTION 'a batch and its videos must stay in the same list' USING ERRCODE = '42501';
    END IF;
    IF NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN
      RETURN NEW;
    END IF;
    -- The one change that is not an attach: the batch was deleted and the foreign key (ON DELETE SET NULL)
    -- blanks the link. The batch is already gone when that runs; nobody can produce the same state by hand.
    IF NEW.parent_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.tasks x WHERE x.id = OLD.parent_id) THEN
      RETURN NEW;
    END IF;
    IF OLD.parent_id IS NOT NULL AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'a video cannot be moved to another batch or taken out of its batch' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only private.attach_batch_parent() (called by create_batch_video) may set it; it flags this task.
  IF auth.uid() IS NOT NULL AND COALESCE(current_setting('tbb.batch_attach', true), '') <> NEW.id::text THEN
    RAISE EXCEPTION 'videos are added to a batch with create_batch_video' USING ERRCODE = '42501';
  END IF;

  -- serialise batch changes per list so the one-level rule cannot be beaten by two at once
  PERFORM pg_advisory_xact_lock(hashtextextended('batch:' || NEW.list_id::text, 0));

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'a task cannot be its own batch' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO p FROM public.tasks x WHERE x.id = NEW.parent_id;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'batch not found' USING ERRCODE = '23503';
  END IF;
  IF p.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'a video cannot itself be a batch (one level only)' USING ERRCODE = '23514';
  END IF;
  IF p.list_id IS DISTINCT FROM NEW.list_id OR p.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'a video must be in the same list as its batch' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tasks c WHERE c.parent_id = NEW.id) THEN
    RAISE EXCEPTION 'a batch cannot become a video (one level only)' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_task_parent() FROM PUBLIC, anon, authenticated;

-- Named so that it fires after trg_tasks_set_workspace (triggers run alphabetically): NEW.workspace_id
-- is then already the list's.
CREATE TRIGGER trg_tasks_z_parent_guard BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_task_parent();

-- ------------------------------------------------------------------------------
-- 2. Attaching (private) and create_batch_video (public)
-- ------------------------------------------------------------------------------

-- Sets parent_id on a task the caller has just created. Requires the caller to be a manager of the
-- workspace (the same people create_task lets in); the guard then checks the batch rules.
CREATE OR REPLACE FUNCTION private.attach_batch_parent(p_task_id UUID, p_parent_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ws UUID;
BEGIN
  SELECT t.workspace_id INTO ws FROM public.tasks t WHERE t.id = p_task_id;
  IF ws IS NULL OR NOT private.is_workspace_manager(ws) THEN
    RAISE EXCEPTION 'you do not have permission to add videos here' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('tbb.batch_attach', p_task_id::text, true);
  UPDATE public.tasks SET parent_id = p_parent_id WHERE id = p_task_id;
  PERFORM set_config('tbb.batch_attach', '', true);
END;
$$;
REVOKE ALL ON FUNCTION private.attach_batch_parent(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.attach_batch_parent(UUID, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_batch_video(
  p_parent_id UUID,
  p_title TEXT,
  p_editor_id UUID DEFAULT NULL,
  p_qc_id UUID DEFAULT NULL
)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  the_list UUID;
  created public.tasks;
BEGIN
  SELECT t.list_id INTO the_list FROM public.tasks t WHERE t.id = p_parent_id;
  IF the_list IS NULL THEN
    RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
  END IF;

  created := public.create_task(
    p_list_id => the_list, p_title => p_title, p_editor_id => p_editor_id, p_qc_id => p_qc_id
  );
  PERFORM private.attach_batch_parent(created.id, p_parent_id);

  SELECT * INTO created FROM public.tasks t WHERE t.id = created.id;
  RETURN created;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. Progress
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.batch_progress(p_parent_ids UUID[])
RETURNS TABLE(parent_id UUID, total INTEGER, finished INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_parent_ids IS NULL OR cardinality(p_parent_ids) > 500 THEN
    RAISE EXCEPTION 'batch_progress: pass between 0 and 500 ids' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH done AS MATERIALIZED (
    SELECT w.workspace_id, ws.key
    FROM public.workflows w
    JOIN public.workflow_statuses ws ON ws.workflow_id = w.id
    WHERE w.is_default AND ws.category = 'COMPLETED'
  )
  SELECT t.parent_id, count(*)::INTEGER, (count(*) FILTER (WHERE d.key IS NOT NULL))::INTEGER
  FROM public.tasks t
  LEFT JOIN done d ON d.workspace_id = t.workspace_id AND d.key = t.status
  WHERE t.parent_id = ANY (p_parent_ids)
  GROUP BY t.parent_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_batch_video(UUID, TEXT, UUID, UUID), public.batch_progress(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_batch_video(UUID, TEXT, UUID, UUID), public.batch_progress(UUID[]) TO authenticated;

-- ==============================================================================
-- Migration 16: Home, Inbox and My Tasks (Phase 11)
-- ==============================================================================
-- Read paths for the personal hub, plus one new piece of state: an Inbox "Done" (archive) marker.
-- Nothing here creates notifications or tasks; every read is SECURITY INVOKER (the caller's RLS).
--
--   1. notifications.archived_at: "Done" in the Inbox. Like read_at it belongs to the recipient
--      only (the existing select/update policies), its time is the server's, and it is the one
--      other column the guard lets change. Un-archiving (back to the Inbox) is allowed.
--   2. latest_revision_notes(task_ids): the latest revision request (note, number, who, when) of
--      each task, for My Tasks rows. Reads task_status_events under RLS; a task the caller cannot
--      see simply returns nothing.
--   3. my_home_summary(workspace, day_start, day_end, week_end): the Home page in one round trip.
--      The caller's own work by due bucket, their QC queue (QC specialists: the tasks they review;
--      managers: every task waiting for QC), revisions in progress, and for managers the
--      workspace-wide overdue / unassigned counts. Day boundaries come from the viewer's time zone.
--      "Needs my action" is NOT counted here: it is a workflow rule computed in the app from the
--      same workflow_transitions rows (one source of truth), on the My Tasks rows.
--
-- My Tasks itself needs no new function: search_tasks already filters by editors / qcs / people.
--
-- Rollback:
--   DROP FUNCTION public.my_home_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ);
--   DROP FUNCTION public.latest_revision_notes(UUID[]);
--   re-run guard_notification() from migration 14;
--   REVOKE UPDATE (archived_at) ON public.notifications FROM authenticated;
--   DROP INDEX public.idx_notifications_inbox; ALTER TABLE public.notifications DROP COLUMN archived_at;
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Inbox "Done"
-- ------------------------------------------------------------------------------

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- the Inbox tab: one person's not-done notifications, newest first
CREATE INDEX IF NOT EXISTS idx_notifications_inbox
  ON public.notifications(user_id, created_at DESC, id) WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION public.guard_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- the one change that is not the recipient's: the actor's account was deleted (ON DELETE SET NULL, profile already gone)
  IF NEW.actor_id IS NULL AND OLD.actor_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.actor_id) THEN
    NEW.actor_id := NULL;
    IF NEW.read_at IS NOT DISTINCT FROM OLD.read_at AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.data IS DISTINCT FROM OLD.data OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'only the read and done state of a notification can be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.read_at IS NOT NULL THEN
    -- the time is the server's, and an already-read notification keeps its first read time
    NEW.read_at := COALESCE(OLD.read_at, NOW());
  END IF;
  IF NEW.archived_at IS NOT NULL THEN
    -- the same for "Done": server time, the first time kept while it stays done
    NEW.archived_at := COALESCE(OLD.archived_at, NOW());
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_notification() FROM PUBLIC, anon, authenticated;

GRANT UPDATE (archived_at) ON TABLE public.notifications TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. Latest revision request per task
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.latest_revision_notes(p_task_ids UUID[])
RETURNS TABLE (
  task_id UUID,
  note TEXT,
  revision_number INT,
  actor_id UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT DISTINCT ON (e.task_id) e.task_id, e.note, e.revision_number, e.actor_id, e.created_at
  FROM public.task_status_events e
  JOIN public.workflows w ON w.workspace_id = e.workspace_id AND w.is_default
  JOIN public.workflow_statuses s ON s.workflow_id = w.id AND s.key = e.to_status AND s.counts_revision
  WHERE e.task_id = ANY (p_task_ids[1:1000])
  ORDER BY e.task_id, e.created_at DESC, e.id DESC
$$;
REVOKE ALL ON FUNCTION public.latest_revision_notes(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.latest_revision_notes(UUID[]) TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. Home summary
-- ------------------------------------------------------------------------------
-- A task's date for bucketing is the earlier of its internal QC due date and client deadline.
-- Finished stages (category COMPLETED) never count as overdue or due. Small tables (stages, lists)
-- are read once (MATERIALIZED), as in migration 15, so the plan stays fast with stale statistics.

CREATE OR REPLACE FUNCTION public.my_home_summary(
  p_workspace_id UUID,
  p_day_start TIMESTAMPTZ,
  p_day_end TIMESTAMPTZ,
  p_week_end TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  me UUID := auth.uid();
  my_role TEXT;
  is_manager BOOLEAN;
  wf UUID;
  mine JSONB;
  queue JSONB;
  revisions JSONB;
  manager JSONB := NULL;
BEGIN
  IF me IS NULL OR NOT private.is_internal_member(p_workspace_id) THEN
    RAISE EXCEPTION 'you do not have access to this workspace''s tasks' USING ERRCODE = '42501';
  END IF;
  IF p_day_start IS NULL OR p_day_end IS NULL OR p_week_end IS NULL
     OR NOT (p_day_start < p_day_end AND p_day_end <= p_week_end) THEN
    RAISE EXCEPTION 'day boundaries must be ordered: day start < day end <= week end' USING ERRCODE = '22023';
  END IF;
  my_role := private.workspace_role(p_workspace_id);
  is_manager := my_role IN ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER');
  wf := private.task_workflow_id(p_workspace_id);

  -- ---- my own work, by bucket ---------------------------------------------------------------
  WITH st AS MATERIALIZED (
    SELECT s.key, s.category FROM public.workflow_statuses s WHERE s.workflow_id = wf
  ),
  my_tasks AS MATERIALIZED (
    SELECT DISTINCT a.task_id FROM public.task_assignees a
    WHERE a.user_id = me AND a.workspace_id = p_workspace_id
  ),
  t AS (
    SELECT LEAST(t.due_date, t.client_deadline) AS d, COALESCE(st.category, '') = 'COMPLETED' AS done
    FROM my_tasks m
    JOIN public.tasks t ON t.id = m.task_id
    LEFT JOIN st ON st.key = t.status
    WHERE t.workspace_id = p_workspace_id
  )
  SELECT jsonb_build_object(
    'total', count(*) FILTER (WHERE NOT done),
    'overdue', count(*) FILTER (WHERE NOT done AND d < p_day_start),
    'dueToday', count(*) FILTER (WHERE NOT done AND d >= p_day_start AND d < p_day_end),
    'dueThisWeek', count(*) FILTER (WHERE NOT done AND d >= p_day_end AND d < p_week_end),
    'later', count(*) FILTER (WHERE NOT done AND (d IS NULL OR d >= p_week_end)),
    'finished', count(*) FILTER (WHERE done)
  ) INTO mine FROM t;

  -- ---- QC queue (waiting for QC) and revisions in progress ----------------------------------
  -- waiting for QC: review stages that need a review link (first / final approval);
  -- revisions: stages that count a revision. QC specialists see the tasks they review; managers
  -- see all; editors see neither list (their own revisions are in My Tasks).
  IF my_role = 'QC_SPECIALIST' OR is_manager THEN
    WITH st AS MATERIALIZED (
      SELECT s.key, s.name, s.requires_review_link, s.counts_revision, s.category
      FROM public.workflow_statuses s WHERE s.workflow_id = wf
    ),
    l AS MATERIALIZED (
      SELECT l.id, l.name FROM public.lists l WHERE l.workspace_id = p_workspace_id
    ),
    q AS (
      SELECT t.id, t.title, t.list_id, l.name AS list_name, t.status, st.name AS status_name,
             st.counts_revision, t.revision_count, qc.user_id AS qc_id, ed.user_id AS editor_id,
             (SELECT max(e.created_at) FROM public.task_status_events e WHERE e.task_id = t.id) AS since
      FROM public.tasks t
      JOIN st ON st.key = t.status AND st.category = 'IN_REVIEW' AND (st.requires_review_link OR st.counts_revision)
      JOIN l ON l.id = t.list_id
      LEFT JOIN public.task_assignees qc ON qc.task_id = t.id AND qc.role_type = 'QC_REVIEWER'
      LEFT JOIN public.task_assignees ed ON ed.task_id = t.id AND ed.role_type = 'EDITOR'
      WHERE t.workspace_id = p_workspace_id
        AND (is_manager OR qc.user_id = me)
    )
    SELECT
      COALESCE((SELECT jsonb_agg(y.x ORDER BY y.since NULLS FIRST, y.id) FROM (
        SELECT jsonb_build_object('id', id, 'title', title, 'listId', list_id, 'listName', list_name,
          'status', status, 'statusName', status_name, 'qcId', qc_id, 'editorId', editor_id,
          'revisionCount', revision_count, 'since', since) AS x, since, id
        FROM q WHERE NOT counts_revision ORDER BY since NULLS FIRST, id LIMIT 50) y(x, since, id)), '[]'::jsonb),
      COALESCE((SELECT jsonb_agg(y.x ORDER BY y.since NULLS FIRST, y.id) FROM (
        SELECT jsonb_build_object('id', id, 'title', title, 'listId', list_id, 'listName', list_name,
          'status', status, 'statusName', status_name, 'qcId', qc_id, 'editorId', editor_id,
          'revisionCount', revision_count, 'since', since) AS x, since, id
        FROM q WHERE counts_revision ORDER BY since NULLS FIRST, id LIMIT 50) y(x, since, id)), '[]'::jsonb)
    INTO queue, revisions;
  ELSE
    queue := '[]'::jsonb;
    revisions := '[]'::jsonb;
  END IF;

  -- ---- managers: the whole workspace ----------------------------------------------------------
  IF is_manager THEN
    WITH st AS MATERIALIZED (
      SELECT s.key, s.category FROM public.workflow_statuses s WHERE s.workflow_id = wf
    ),
    t AS (
      SELECT LEAST(t.due_date, t.client_deadline) AS d,
             EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = t.id AND a.role_type = 'EDITOR') AS has_editor,
             EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = t.id AND a.role_type = 'QC_REVIEWER') AS has_qc
      FROM public.tasks t
      LEFT JOIN st ON st.key = t.status
      WHERE t.workspace_id = p_workspace_id AND COALESCE(st.category, '') <> 'COMPLETED'
    )
    SELECT jsonb_build_object(
      'open', count(*),
      'overdue', count(*) FILTER (WHERE d < p_day_start),
      'noEditor', count(*) FILTER (WHERE NOT has_editor),
      'noQc', count(*) FILTER (WHERE NOT has_qc)
    ) INTO manager FROM t;
  END IF;

  RETURN jsonb_build_object(
    'role', my_role,
    'mine', mine,
    'qcQueue', queue,
    'revisions', revisions,
    'manager', manager
  );
END;
$$;
REVOKE ALL ON FUNCTION public.my_home_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_home_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

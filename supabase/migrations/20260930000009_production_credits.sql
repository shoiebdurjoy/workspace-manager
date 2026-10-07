-- ==============================================================================
-- Migration 9: first-QC production credits (employee production analytics)
-- ==============================================================================
-- TBB measures an editor's production by the moment they FIRST submit a video for QC
-- (the task first enters QC - FIRST APPROVAL), not by final approval or client delivery:
-- a video can sit in QC / revision / client review for weeks after the editing is done.
--
-- Guarantees (enforced here, not in the app):
--   * one credit per task, ever (task_id is the primary key; ON CONFLICT DO NOTHING);
--   * the credit belongs to the editor assigned at that moment and to that moment's date;
--     later reassignment, revisions, re-submissions, approval or delivery never change it;
--   * nobody can write, change or delete a credit through the API (no write grants, no
--     policies), and an UPDATE or direct DELETE is refused even for the service role;
--   * a task that earned a credit cannot be deleted (it is part of someone's history);
--     only deleting the whole workspace removes credits (cascade).
--   * only the workspace Owner / Admins can read credits.
--
-- The task stays the source of truth for everything else (title, links, list): the credit
-- holds only who, which task and when.
--
-- Rollback (loses production history):
--   DROP FUNCTION public.production_videos(UUID, UUID, INT, INT, TEXT);
--   DROP FUNCTION public.production_monthly(UUID, TEXT);
--   DROP TRIGGER trg_tasks_workflow_production ON public.tasks;
--   DROP FUNCTION public.record_production_credit();
--   DROP TABLE public.task_production_credits;
--   ALTER TABLE public.workflow_statuses DROP COLUMN credits_production;
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Which stage earns the credit is workflow configuration
-- ------------------------------------------------------------------------------

ALTER TABLE public.workflow_statuses ADD COLUMN IF NOT EXISTS credits_production BOOLEAN NOT NULL DEFAULT false;
UPDATE public.workflow_statuses SET credits_production = true WHERE key = 'QC_FIRST_APPROVAL';
-- at most one production stage per workflow
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_statuses_production
  ON public.workflow_statuses(workflow_id) WHERE credits_production;

-- new workspaces: the TBB workflow is created by migration 8's trigger; mark its production stage
CREATE OR REPLACE FUNCTION public.handle_new_workspace_workflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  wf UUID;
BEGIN
  wf := private.create_tbb_workflow(NEW.id);
  UPDATE public.workflow_statuses SET credits_production = true WHERE workflow_id = wf AND key = 'QC_FIRST_APPROVAL';
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_workspace_workflow() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 2. The credits
-- ------------------------------------------------------------------------------

CREATE TABLE public.task_production_credits (
  -- one credit per task, ever; NO ACTION: a credited task cannot be deleted on its own
  task_id UUID PRIMARY KEY REFERENCES public.tasks(id),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- the editor assigned when the task first reached first QC (not whoever is assigned now)
  editor_id UUID NOT NULL REFERENCES public.profiles(id),
  first_qc_submitted_at TIMESTAMPTZ NOT NULL,
  -- who made the move (the editor, or a manager on their behalf); audit only
  submitted_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_production_credits_ws_time ON public.task_production_credits(workspace_id, first_qc_submitted_at);
CREATE INDEX idx_production_credits_editor_time ON public.task_production_credits(editor_id, first_qc_submitted_at);

ALTER TABLE public.task_production_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_production_credits_select_admins" ON public.task_production_credits FOR SELECT TO authenticated
  USING (private.is_workspace_admin(workspace_id));
-- written by trigger only: no INSERT / UPDATE / DELETE policy and no write grant
GRANT SELECT ON TABLE public.task_production_credits TO authenticated;
GRANT ALL ON TABLE public.task_production_credits TO service_role;
REVOKE ALL ON TABLE public.task_production_credits FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.task_production_credits FROM authenticated;

-- permanent: no change ever; deletion only as part of deleting the whole workspace (a cascade)
CREATE OR REPLACE FUNCTION public.guard_production_credit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'production credits are permanent and cannot be changed' USING ERRCODE = '42501';
  END IF;
  -- depth 1 = a direct DELETE; a workspace deletion reaches here through the FK cascade (depth > 1)
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'production credits are permanent and cannot be deleted' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_production_credit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_production_credits_guard BEFORE UPDATE OR DELETE ON public.task_production_credits
  FOR EACH ROW EXECUTE FUNCTION public.guard_production_credit();

-- ------------------------------------------------------------------------------
-- 3. Recording the credit (the first time a task enters the production stage)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_production_credit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ed UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workflow_statuses s
    WHERE s.workflow_id = private.task_workflow_id(NEW.workspace_id) AND s.key = NEW.status AND s.credits_production
  ) THEN
    RETURN NULL;
  END IF;
  SELECT a.user_id INTO ed FROM public.task_assignees a WHERE a.task_id = NEW.id AND a.role_type = 'EDITOR';
  IF ed IS NULL THEN
    RETURN NULL; -- the stage requires an editor, so this does not happen; never credit nobody
  END IF;
  -- the first submission wins forever: a re-submission after a revision is not a new credit
  INSERT INTO public.task_production_credits (task_id, workspace_id, editor_id, first_qc_submitted_at, submitted_by)
  VALUES (NEW.id, NEW.workspace_id, ed, NOW(), auth.uid())
  ON CONFLICT (task_id) DO NOTHING;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.record_production_credit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_tasks_workflow_production ON public.tasks;
CREATE TRIGGER trg_tasks_workflow_production AFTER INSERT OR UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.record_production_credit();

-- No backfill: a task that is already past first QC has no known first-submission time or editor
-- (production has none at the time of writing). Credits start with this migration.

-- ------------------------------------------------------------------------------
-- 4. Reading (Owner / Admin): SECURITY INVOKER, so RLS on every table applies to the caller
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.check_timezone(tz TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = tz) THEN
    RAISE EXCEPTION 'unknown time zone' USING ERRCODE = '22023';
  END IF;
  RETURN tz;
END;
$$;
REVOKE ALL ON FUNCTION private.check_timezone(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.check_timezone(TEXT) TO authenticated, service_role;

-- Credits per editor per calendar month (months in the given time zone), all years.
CREATE OR REPLACE FUNCTION public.production_monthly(p_workspace_id UUID, p_timezone TEXT DEFAULT 'UTC')
RETURNS TABLE (editor_id UUID, year INT, month INT, credits INT)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  tz TEXT := private.check_timezone(p_timezone);
BEGIN
  IF NOT private.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'only the owner and admins can see production analytics' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT c.editor_id,
           EXTRACT(YEAR FROM c.first_qc_submitted_at AT TIME ZONE tz)::INT,
           EXTRACT(MONTH FROM c.first_qc_submitted_at AT TIME ZONE tz)::INT,
           COUNT(*)::INT
    FROM public.task_production_credits c
    WHERE c.workspace_id = p_workspace_id
    GROUP BY 1, 2, 3
    ORDER BY 2, 3;
END;
$$;
REVOKE ALL ON FUNCTION public.production_monthly(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.production_monthly(UUID, TEXT) TO authenticated;

-- The videos behind one editor's month: the real tasks, with their list context and links.
CREATE OR REPLACE FUNCTION public.production_videos(
  p_workspace_id UUID,
  p_editor_id UUID,
  p_year INT,
  p_month INT,
  p_timezone TEXT DEFAULT 'UTC'
)
RETURNS TABLE (
  task_id UUID,
  title TEXT,
  status TEXT,
  first_qc_submitted_at TIMESTAMPTZ,
  submitted_by UUID,
  list_id UUID,
  list_name TEXT,
  folder_name TEXT,
  space_id UUID,
  space_name TEXT,
  review_link TEXT,
  final_export_link TEXT,
  project_file_link TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  tz TEXT := private.check_timezone(p_timezone);
  starts TIMESTAMPTZ;
BEGIN
  IF NOT private.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'only the owner and admins can see production analytics' USING ERRCODE = '42501';
  END IF;
  IF p_month IS NULL OR p_month NOT BETWEEN 1 AND 12 OR p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2200 THEN
    RAISE EXCEPTION 'choose a valid month' USING ERRCODE = '22023';
  END IF;
  starts := make_timestamp(p_year, p_month, 1, 0, 0, 0) AT TIME ZONE tz;
  RETURN QUERY
    SELECT c.task_id, t.title::TEXT, t.status::TEXT, c.first_qc_submitted_at, c.submitted_by,
           l.id, l.name::TEXT, f.name::TEXT, s.id, s.name::TEXT,
           t.review_link::TEXT, t.final_export_link::TEXT, t.project_file_link::TEXT
    FROM public.task_production_credits c
    JOIN public.tasks t ON t.id = c.task_id
    JOIN public.lists l ON l.id = t.list_id
    LEFT JOIN public.folders f ON f.id = l.folder_id
    JOIN public.spaces s ON s.id = l.space_id
    WHERE c.workspace_id = p_workspace_id
      AND c.editor_id = p_editor_id
      AND c.first_qc_submitted_at >= starts
      AND c.first_qc_submitted_at < (make_timestamp(p_year, p_month, 1, 0, 0, 0) + INTERVAL '1 month') AT TIME ZONE tz
    ORDER BY c.first_qc_submitted_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.production_videos(UUID, UUID, INT, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.production_videos(UUID, UUID, INT, INT, TEXT) TO authenticated;

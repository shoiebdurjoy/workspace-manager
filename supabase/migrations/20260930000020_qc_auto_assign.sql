-- ==============================================================================
-- Migration 20: QC auto-assignment
-- ==============================================================================
-- When a task enters a QC review stage (a stage that requires the review link: "QC - FIRST APPROVAL",
-- "QC - FINAL APPROVAL") and has NO QC reviewer, the database assigns one, so a cut never waits in QC
-- with nobody looking at it.
--
-- Who: an active QC specialist of the workspace, chosen in this order
--   1. availability (migration 19): AVAILABLE, then WORKING or no status, then BUSY; ON_LEAVE is never picked
--   2. fewest tasks currently waiting in a QC review stage with them as reviewer
--   3. least recently given a QC assignment (spreads the work), then a stable tie-break
-- A task that already has a QC reviewer keeps them (final approval stays with the first reviewer).
-- If nobody can take it (no QC specialist, or all on leave) the task stays unassigned, exactly as before.
--
-- The assignment goes through task_assignees like any other, so its guard, the activity entry and the
-- "assigned" notification to the reviewer all happen as usual.
--
-- Rollback: DROP TRIGGER trg_tasks_qc_auto_assign ON public.tasks; DROP FUNCTION public.qc_auto_assign();
--           DROP FUNCTION private.pick_qc_reviewer(UUID, UUID);
-- ==============================================================================

CREATE OR REPLACE FUNCTION private.pick_qc_reviewer(p_workspace_id UUID, p_workflow_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH review AS MATERIALIZED (
    SELECT s.key FROM public.workflow_statuses s
    WHERE s.workflow_id = p_workflow_id AND s.requires_review_link AND s.category = 'IN_REVIEW'
  ),
  candidates AS (
    SELECT m.user_id,
           CASE a.status WHEN 'AVAILABLE' THEN 0 WHEN 'WORKING' THEN 1 WHEN 'BUSY' THEN 2 ELSE 1 END AS avail_rank
    FROM public.workspace_members m
    JOIN public.profiles p ON p.id = m.user_id AND p.is_active
    LEFT JOIN public.member_availability a ON a.workspace_id = m.workspace_id AND a.user_id = m.user_id
    WHERE m.workspace_id = p_workspace_id
      AND m.role = 'QC_SPECIALIST'
      AND COALESCE(a.status, '') <> 'ON_LEAVE'
  )
  SELECT c.user_id
  FROM candidates c
  LEFT JOIN LATERAL (
    SELECT count(*) AS waiting
    FROM public.task_assignees ta
    JOIN public.tasks t ON t.id = ta.task_id
    WHERE ta.user_id = c.user_id AND ta.role_type = 'QC_REVIEWER' AND ta.workspace_id = p_workspace_id
      AND t.status IN (SELECT key FROM review)
  ) load ON true
  LEFT JOIN LATERAL (
    SELECT max(ta.assigned_at) AS last_at
    FROM public.task_assignees ta
    WHERE ta.user_id = c.user_id AND ta.role_type = 'QC_REVIEWER' AND ta.workspace_id = p_workspace_id
  ) recent ON true
  ORDER BY c.avail_rank, load.waiting, recent.last_at NULLS FIRST, c.user_id
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.pick_qc_reviewer(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.qc_auto_assign()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  wf UUID;
  is_review BOOLEAN;
  reviewer UUID;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  wf := private.task_workflow_id(NEW.workspace_id);
  SELECT s.requires_review_link AND s.category = 'IN_REVIEW' INTO is_review
  FROM public.workflow_statuses s WHERE s.workflow_id = wf AND s.key = NEW.status;
  IF NOT COALESCE(is_review, false) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.task_assignees WHERE task_id = NEW.id AND role_type = 'QC_REVIEWER') THEN
    RETURN NULL;
  END IF;
  reviewer := private.pick_qc_reviewer(NEW.workspace_id, wf);
  IF reviewer IS NULL THEN
    RETURN NULL;
  END IF;
  -- the editor who submitted the cut can never review it (a QC specialist is never the editor anyway)
  IF EXISTS (SELECT 1 FROM public.task_assignees WHERE task_id = NEW.id AND role_type = 'EDITOR' AND user_id = reviewer) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES (NEW.id, 'QC_REVIEWER', reviewer)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.qc_auto_assign() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_tasks_qc_auto_assign AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.qc_auto_assign();

-- Migration 40: moving a video between statuses never asks for anything.
--
-- The team keeps every link in the video's fields (A) raw video ... E) link to the edited video), so a move no
-- longer asks for a review link, a final export or a note: in this workspace's workflow those three asks are
-- switched off. Other rules stay (a stage that needs an editor still needs one assigned; revisions still count).
-- Workspaces created later start with the standard workflow; an admin can change it in Customize workspace.
--
-- QC auto-assignment used "asks for a review link" to recognise a QC review stage. It now recognises one by its
-- group: a status in the "In review (QC)" group that is not a revision request (QC- FIRST APPROVAL, QC- FINAL
-- APPROVAL), so it keeps working with the asks switched off.
--
-- Rollback: UPDATE public.workflow_statuses SET requires_review_link = true WHERE key IN ('QC_FIRST_APPROVAL',
--   'QC_FINAL_APPROVAL'); ... requires_final_export = true WHERE key = 'SENT_TO_CLIENT'; ... requires_note = true
--   WHERE key IN ('QC_REVISION_NEEDED', 'CLIENT_REVISION_NEEDED'); restore the two functions from migrations 20 and 26.

CREATE OR REPLACE FUNCTION private.pick_qc_reviewer(p_workspace_id UUID, p_workflow_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH review AS MATERIALIZED (
    SELECT s.key FROM public.workflow_statuses s
    WHERE s.workflow_id = p_workflow_id AND s.category = 'IN_REVIEW' AND NOT s.counts_revision
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
  SELECT s.category = 'IN_REVIEW' AND NOT s.counts_revision INTO is_review
  FROM public.workflow_statuses s WHERE s.workflow_id = wf AND s.key = NEW.status;
  IF NOT COALESCE(is_review, false) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.task_assignees WHERE task_id = NEW.id AND role_type = 'QC_REVIEWER') THEN
    RETURN NULL;
  END IF;
  reviewer := COALESCE(private.default_qc_for_task(NEW.id), private.pick_qc_reviewer(NEW.workspace_id, wf));
  IF reviewer IS NULL THEN
    RETURN NULL;
  END IF;
  -- the editor who submitted the cut can never review it
  IF EXISTS (SELECT 1 FROM public.task_assignees WHERE task_id = NEW.id AND role_type = 'EDITOR' AND user_id = reviewer) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES (NEW.id, 'QC_REVIEWER', reviewer)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;

UPDATE public.workflow_statuses SET requires_review_link = false, requires_final_export = false, requires_note = false
WHERE requires_review_link OR requires_final_export OR requires_note;

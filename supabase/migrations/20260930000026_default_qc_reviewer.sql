-- Migration 26: a default QC reviewer per folder and per list ("CONTENT PIPELINE - ZIM" is Zim's, "- MYLA" is Myla's).
--
-- When a cut enters a QC review stage with no QC reviewer, the auto-assign trigger (migration 20) now picks, in order:
--   1. the list's default QC reviewer,
--   2. else the default QC reviewer of the list's folder,
--   3. else the least-loaded available QC specialist (unchanged).
-- A default is used only while that person is an active member who may review (QC specialist, owner, admin or
-- production manager), is not on leave, and is not the task's editor; otherwise the next rule applies.
-- Moving a list to another folder therefore moves its future reviews to that folder's reviewer.
--
-- Who can set it: whoever can update the folder / list (managers, existing RLS). The guard below refuses a person
-- who is not a reviewing member of the same workspace.
--
-- Rollback: restore public.qc_auto_assign() from migration 20; DROP FUNCTION private.default_qc_for_task(UUID),
--   public.guard_default_qc(); ALTER TABLE public.lists DROP COLUMN default_qc_id; ALTER TABLE public.folders DROP COLUMN default_qc_id;

ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS default_qc_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.lists ADD COLUMN IF NOT EXISTS default_qc_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.guard_default_qc()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.default_qc_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.default_qc_id IS NOT DISTINCT FROM OLD.default_qc_id) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.default_qc_id
      AND m.role IN ('QC_SPECIALIST', 'OWNER', 'ADMIN', 'PRODUCTION_MANAGER')
  ) THEN
    RAISE EXCEPTION 'the default QC reviewer must be a QC specialist or manager of this workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_default_qc() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_folders_default_qc ON public.folders;
CREATE TRIGGER trg_folders_default_qc BEFORE INSERT OR UPDATE OF default_qc_id ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.guard_default_qc();
DROP TRIGGER IF EXISTS trg_lists_default_qc ON public.lists;
CREATE TRIGGER trg_lists_default_qc BEFORE INSERT OR UPDATE OF default_qc_id ON public.lists
  FOR EACH ROW EXECUTE FUNCTION public.guard_default_qc();

-- the list's default, else its folder's, if that person may review right now
CREATE OR REPLACE FUNCTION private.default_qc_for_task(p_task_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT cand.user_id
  FROM public.tasks t
  JOIN public.lists l ON l.id = t.list_id
  LEFT JOIN public.folders f ON f.id = l.folder_id
  CROSS JOIN LATERAL (VALUES (l.default_qc_id, 1), (f.default_qc_id, 2)) AS cand(user_id, rank)
  JOIN public.workspace_members m ON m.workspace_id = t.workspace_id AND m.user_id = cand.user_id
    AND m.role IN ('QC_SPECIALIST', 'OWNER', 'ADMIN', 'PRODUCTION_MANAGER')
  JOIN public.profiles p ON p.id = cand.user_id AND p.is_active
  LEFT JOIN public.member_availability a ON a.workspace_id = t.workspace_id AND a.user_id = cand.user_id
  WHERE t.id = p_task_id
    AND cand.user_id IS NOT NULL
    AND COALESCE(a.status, '') <> 'ON_LEAVE'
    AND NOT EXISTS (SELECT 1 FROM public.task_assignees ta WHERE ta.task_id = t.id AND ta.role_type = 'EDITOR' AND ta.user_id = cand.user_id)
  ORDER BY cand.rank
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.default_qc_for_task(UUID) FROM PUBLIC, anon, authenticated;

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
REVOKE ALL ON FUNCTION public.qc_auto_assign() FROM PUBLIC, anon, authenticated;

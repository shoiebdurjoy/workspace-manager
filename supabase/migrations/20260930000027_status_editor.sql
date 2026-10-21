-- Migration 27: Owner / Admin customize the workflow (Settings > Customize > Statuses).
--
-- Until now statuses and moves were read-only configuration. Owner and Admin may now:
--   * rename, recolour, re-order, re-describe and re-categorise a status, and add new ones;
--   * delete a status that no task is in (never the starting status or the production-credit stage);
--   * add, relabel and remove the moves between statuses and choose which roles may make each move.
-- A status KEY never changes (tasks store it), and the rule flags (requires editor / review link / final export /
-- note, counts revision, is initial, credits production) stay as the system set them: no column grant covers them.
-- Production managers, QC, editors and clients keep read-only access.
--
-- Rollback: DROP the six policies and the trigger below, DROP FUNCTION public.guard_status_delete(), and
--   REVOKE INSERT, UPDATE, DELETE ON public.workflow_statuses, public.workflow_transitions FROM authenticated;

CREATE POLICY "workflow_statuses_admin_insert" ON public.workflow_statuses FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND private.is_workspace_admin(w.workspace_id)));
CREATE POLICY "workflow_statuses_admin_update" ON public.workflow_statuses FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND private.is_workspace_admin(w.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND private.is_workspace_admin(w.workspace_id)));
CREATE POLICY "workflow_statuses_admin_delete" ON public.workflow_statuses FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND private.is_workspace_admin(w.workspace_id)));

CREATE POLICY "workflow_transitions_admin_insert" ON public.workflow_transitions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND private.is_workspace_admin(w.workspace_id)));
CREATE POLICY "workflow_transitions_admin_update" ON public.workflow_transitions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND private.is_workspace_admin(w.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND private.is_workspace_admin(w.workspace_id)));
CREATE POLICY "workflow_transitions_admin_delete" ON public.workflow_transitions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND private.is_workspace_admin(w.workspace_id)));

-- only the presentational columns are writable; keys and rule flags are not
GRANT INSERT (workflow_id, key, name, category, color, position, description) ON TABLE public.workflow_statuses TO authenticated;
GRANT UPDATE (name, category, color, position, description) ON TABLE public.workflow_statuses TO authenticated;
GRANT DELETE ON TABLE public.workflow_statuses TO authenticated;
GRANT INSERT (workflow_id, from_key, to_key, label, kind, roles) ON TABLE public.workflow_transitions TO authenticated;
GRANT UPDATE (label, kind, roles) ON TABLE public.workflow_transitions TO authenticated;
GRANT DELETE ON TABLE public.workflow_transitions TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_status_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ws UUID;
  n INT;
BEGIN
  -- the whole workflow going away (workspace deleted) is not a customization
  SELECT workspace_id INTO ws FROM public.workflows WHERE id = OLD.workflow_id;
  IF ws IS NULL THEN
    RETURN OLD;
  END IF;
  IF OLD.is_initial THEN
    RAISE EXCEPTION 'the starting status cannot be deleted' USING ERRCODE = '42501';
  END IF;
  IF OLD.credits_production THEN
    RAISE EXCEPTION 'the production-credit stage cannot be deleted' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO n FROM public.tasks WHERE workspace_id = ws AND status = OLD.key;
  IF n > 0 THEN
    RAISE EXCEPTION '% task(s) are in %; move them to another status first', n, OLD.name USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_status_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_workflow_statuses_guard_delete ON public.workflow_statuses;
CREATE TRIGGER trg_workflow_statuses_guard_delete BEFORE DELETE ON public.workflow_statuses
  FOR EACH ROW EXECUTE FUNCTION public.guard_status_delete();

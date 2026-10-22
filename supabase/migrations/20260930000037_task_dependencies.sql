-- Migration 37: dependencies between videos, like ClickUp's "waiting on" / "blocking" (task detail > Waiting on).
--
-- A video can wait on other videos of the same workspace (e.g. the long cut waits on the raw-footage selects). The
-- app shows "waiting on N" while any of them is still open, and the blocked ones on the other side. It is a signal,
-- not a lock: nobody is stopped from working. A video cannot wait on itself, nor on something that (directly or
-- through others) already waits on it. Managers add and remove dependencies; the staff see them.
--
-- Rollback: DROP TABLE public.task_dependencies; DROP FUNCTION public.guard_task_dependency();

CREATE TABLE public.task_dependencies (
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  depends_on_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id <> depends_on_id)
);
CREATE INDEX idx_task_dependencies_on ON public.task_dependencies(depends_on_id);
CREATE INDEX idx_task_dependencies_workspace ON public.task_dependencies(workspace_id);

CREATE OR REPLACE FUNCTION public.guard_task_dependency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  a UUID;
  b UUID;
BEGIN
  SELECT workspace_id INTO a FROM public.tasks WHERE id = NEW.task_id;
  SELECT workspace_id INTO b FROM public.tasks WHERE id = NEW.depends_on_id;
  IF a IS NULL OR b IS NULL OR a <> b THEN
    RAISE EXCEPTION 'both videos must be in the same workspace' USING ERRCODE = '23514';
  END IF;
  -- no cycles: the new prerequisite must not (transitively) wait on this video
  IF EXISTS (
    WITH RECURSIVE chain(id) AS (
      SELECT d.depends_on_id FROM public.task_dependencies d WHERE d.task_id = NEW.depends_on_id
      UNION
      SELECT d.depends_on_id FROM public.task_dependencies d JOIN chain c ON d.task_id = c.id
    )
    SELECT 1 FROM chain WHERE id = NEW.task_id
  ) THEN
    RAISE EXCEPTION 'that would make the videos wait on each other in a circle' USING ERRCODE = '23514';
  END IF;
  NEW.workspace_id := a;
  NEW.created_by := auth.uid();
  NEW.created_at := NOW();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_task_dependency() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_task_dependencies_guard BEFORE INSERT ON public.task_dependencies FOR EACH ROW EXECUTE FUNCTION public.guard_task_dependency();

ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_dependencies_select" ON public.task_dependencies FOR SELECT TO authenticated USING (private.is_internal_member(workspace_id));
CREATE POLICY "task_dependencies_insert" ON public.task_dependencies FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_manager((SELECT t.workspace_id FROM public.tasks t WHERE t.id = task_id)));
CREATE POLICY "task_dependencies_delete" ON public.task_dependencies FOR DELETE TO authenticated USING (private.is_workspace_manager(workspace_id));
GRANT SELECT, DELETE ON TABLE public.task_dependencies TO authenticated;
GRANT INSERT (task_id, depends_on_id) ON TABLE public.task_dependencies TO authenticated;
GRANT ALL ON TABLE public.task_dependencies TO service_role;
REVOKE ALL ON TABLE public.task_dependencies FROM anon;
REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.task_dependencies FROM authenticated;

-- Migration 36: recurring videos, like ClickUp's "recur on completion" (task detail > Repeat).
--
-- A manager marks a video as repeating every N days / weeks / months. When it is CLOSED (any status in the
-- "Closed" group), the next one is created in the same list at once: same title, brief, priority, aspect ratio,
-- custom field values and tags, the dates moved forward by the interval (from the old due date, or from today when
-- there was none), optionally the same editor and QC reviewer. The repeat rule moves to the new video, so the chain
-- goes on until someone stops it. Reopening and closing a video again does not create a second copy.
-- No scheduler is involved: everything happens inside the change that closes the video.
--
-- Rollback: DROP TRIGGER trg_tasks_zy_recur ON public.tasks; DROP FUNCTION public.recur_task_on_close();
--   DROP TABLE public.task_recurrence;

CREATE TABLE public.task_recurrence (
  task_id UUID PRIMARY KEY REFERENCES public.tasks(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  every INTEGER NOT NULL CHECK (every BETWEEN 1 AND 365),
  unit TEXT NOT NULL CHECK (unit IN ('day', 'week', 'month')),
  copy_people BOOLEAN NOT NULL DEFAULT true,
  spawned_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_task_recurrence_workspace ON public.task_recurrence(workspace_id);

CREATE OR REPLACE FUNCTION public.guard_task_recurrence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  SELECT workspace_id INTO NEW.workspace_id FROM public.tasks WHERE id = NEW.task_id;
  IF NEW.workspace_id IS NULL THEN
    RAISE EXCEPTION 'task % does not exist', NEW.task_id USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
    NEW.created_at := NOW();
    IF current_setting('tbb.recur', true) IS DISTINCT FROM 'on' THEN
      NEW.spawned_task_id := NULL;
    END IF;
  ELSE
    IF NEW.task_id IS DISTINCT FROM OLD.task_id THEN
      RAISE EXCEPTION 'a repeat rule cannot move to another task' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    -- only the engine records which video a rule created
    IF current_setting('tbb.recur', true) IS DISTINCT FROM 'on' THEN
      NEW.spawned_task_id := OLD.spawned_task_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_task_recurrence() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_task_recurrence_guard BEFORE INSERT OR UPDATE ON public.task_recurrence FOR EACH ROW EXECUTE FUNCTION public.guard_task_recurrence();

ALTER TABLE public.task_recurrence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_recurrence_select" ON public.task_recurrence FOR SELECT TO authenticated USING (private.is_internal_member(workspace_id));
CREATE POLICY "task_recurrence_insert" ON public.task_recurrence FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_manager((SELECT t.workspace_id FROM public.tasks t WHERE t.id = task_id)));
CREATE POLICY "task_recurrence_update" ON public.task_recurrence FOR UPDATE TO authenticated
  USING (private.is_workspace_manager(workspace_id)) WITH CHECK (private.is_workspace_manager(workspace_id));
CREATE POLICY "task_recurrence_delete" ON public.task_recurrence FOR DELETE TO authenticated USING (private.is_workspace_manager(workspace_id));
GRANT SELECT, DELETE ON TABLE public.task_recurrence TO authenticated;
GRANT INSERT (task_id, every, unit, copy_people) ON TABLE public.task_recurrence TO authenticated;
GRANT UPDATE (every, unit, copy_people) ON TABLE public.task_recurrence TO authenticated;
GRANT ALL ON TABLE public.task_recurrence TO service_role;
REVOKE ALL ON TABLE public.task_recurrence FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.task_recurrence FROM authenticated;

CREATE OR REPLACE FUNCTION public.recur_task_on_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  rule RECORD;
  step INTERVAL;
  closed_now BOOLEAN;
  was_closed BOOLEAN;
  next_id UUID;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  SELECT r.* INTO rule FROM public.task_recurrence r WHERE r.task_id = NEW.id;
  IF rule.task_id IS NULL OR rule.spawned_task_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  SELECT s.category = 'COMPLETED' INTO closed_now FROM public.workflow_statuses s WHERE s.workflow_id = private.task_workflow_id(NEW.workspace_id) AND s.key = NEW.status;
  SELECT s.category = 'COMPLETED' INTO was_closed FROM public.workflow_statuses s WHERE s.workflow_id = private.task_workflow_id(NEW.workspace_id) AND s.key = OLD.status;
  IF NOT COALESCE(closed_now, false) OR COALESCE(was_closed, false) THEN
    RETURN NULL;
  END IF;

  step := make_interval(days => CASE rule.unit WHEN 'day' THEN rule.every WHEN 'week' THEN rule.every * 7 ELSE 0 END,
                        months => CASE rule.unit WHEN 'month' THEN rule.every ELSE 0 END);

  INSERT INTO public.tasks (list_id, title, description, priority, aspect_ratio, due_date, client_deadline, created_by)
  VALUES (NEW.list_id, NEW.title, NEW.description, NEW.priority, NEW.aspect_ratio,
          COALESCE(NEW.due_date, date_trunc('day', NOW()) + interval '12 hours') + step,
          CASE WHEN NEW.client_deadline IS NULL THEN NULL ELSE NEW.client_deadline + step END,
          NEW.created_by)
  RETURNING id INTO next_id;

  -- copies are best effort: a field, tag or person that no longer fits is skipped
  BEGIN
    INSERT INTO public.custom_field_values (task_id, field_id, workspace_id, value)
    SELECT next_id, v.field_id, v.workspace_id, v.value FROM public.custom_field_values v WHERE v.task_id = NEW.id
    ON CONFLICT (task_id, field_id) DO UPDATE SET value = EXCLUDED.value;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    INSERT INTO public.task_tags (task_id, tag_id) SELECT next_id, tt.tag_id FROM public.task_tags tt WHERE tt.task_id = NEW.id ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF rule.copy_people THEN
    BEGIN
      INSERT INTO public.task_assignees (task_id, role_type, user_id)
      SELECT next_id, a.role_type, a.user_id FROM public.task_assignees a WHERE a.task_id = NEW.id
      ON CONFLICT (task_id, role_type) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  -- the rule travels to the new video; the old one remembers what it created (so closing it again does nothing)
  PERFORM set_config('tbb.recur', 'on', true);
  UPDATE public.task_recurrence SET spawned_task_id = next_id WHERE task_id = NEW.id;
  INSERT INTO public.task_recurrence (task_id, workspace_id, every, unit, copy_people, created_by)
  VALUES (next_id, NEW.workspace_id, rule.every, rule.unit, rule.copy_people, rule.created_by);
  PERFORM set_config('tbb.recur', 'off', true);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.recur_task_on_close() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_tasks_zy_recur AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.recur_task_on_close();

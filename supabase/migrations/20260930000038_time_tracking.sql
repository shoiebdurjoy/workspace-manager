-- Migration 38: time tracking, like ClickUp's (task detail > Time: start / stop a timer, add time by hand, estimate).
--
--   time_entries  who worked on which video and for how long. A running timer has no end yet; one person has at
--                 most one running timer (starting another stops nothing by itself: the app stops the old one
--                 first). An entry is at most 24 hours; a manual entry needs both ends. Everyone records and edits
--                 only their own time, on videos they can see; managers can also delete anyone's entry. The staff
--                 see all entries (so managers can total time per video and per person); clients see nothing.
--   tasks.time_estimate_minutes  the planned time for a video (managers set it like the other brief fields).
--
-- Also adds 'recurring', 'dependencies' and 'time_tracking' to the feature switches.
--
-- Rollback: restore set_workspace_feature() from migration 30; DROP TABLE public.time_entries; DROP FUNCTION public.guard_time_entry();
--   ALTER TABLE public.tasks DROP COLUMN time_estimate_minutes;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS time_estimate_minutes INTEGER CHECK (time_estimate_minutes IS NULL OR time_estimate_minutes BETWEEN 1 AND 100000);

CREATE TABLE public.time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  note TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ended_at IS NULL OR (ended_at > started_at AND ended_at - started_at <= interval '24 hours'))
);
CREATE INDEX idx_time_entries_task ON public.time_entries(task_id);
CREATE INDEX idx_time_entries_user ON public.time_entries(workspace_id, user_id, started_at DESC);
CREATE UNIQUE INDEX idx_time_entries_one_running ON public.time_entries(user_id) WHERE ended_at IS NULL;

CREATE OR REPLACE FUNCTION public.guard_time_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.user_id := auth.uid();
    NEW.created_at := NOW();
    SELECT workspace_id INTO NEW.workspace_id FROM public.tasks WHERE id = NEW.task_id;
    IF NEW.workspace_id IS NULL THEN
      RAISE EXCEPTION 'task % does not exist', NEW.task_id USING ERRCODE = '23503';
    END IF;
  ELSE
    IF NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'a time entry cannot move to another video or person' USING ERRCODE = '42501';
    END IF;
    NEW.workspace_id := OLD.workspace_id;
    NEW.created_at := OLD.created_at;
  END IF;
  IF NEW.started_at > NOW() + interval '5 minutes' THEN
    RAISE EXCEPTION 'time cannot start in the future' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_time_entry() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_time_entries_guard BEFORE INSERT OR UPDATE ON public.time_entries FOR EACH ROW EXECUTE FUNCTION public.guard_time_entry();

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "time_entries_select" ON public.time_entries FOR SELECT TO authenticated USING (private.is_internal_member(workspace_id));
CREATE POLICY "time_entries_insert" ON public.time_entries FOR INSERT TO authenticated
  WITH CHECK (private.is_internal_member((SELECT t.workspace_id FROM public.tasks t WHERE t.id = task_id)));
CREATE POLICY "time_entries_update" ON public.time_entries FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "time_entries_delete" ON public.time_entries FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR private.is_workspace_manager(workspace_id));
GRANT SELECT, DELETE ON TABLE public.time_entries TO authenticated;
GRANT INSERT (task_id, started_at, ended_at, note) ON TABLE public.time_entries TO authenticated;
GRANT UPDATE (started_at, ended_at, note) ON TABLE public.time_entries TO authenticated;
GRANT ALL ON TABLE public.time_entries TO service_role;
REVOKE ALL ON TABLE public.time_entries FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.time_entries FROM authenticated;

-- recurring videos, dependencies and time tracking join the feature switches
CREATE OR REPLACE FUNCTION public.set_workspace_feature(p_workspace_id UUID, p_feature TEXT, p_enabled BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  out JSONB;
BEGIN
  IF NOT private.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'only the owner or an admin can switch features' USING ERRCODE = '42501';
  END IF;
  IF p_feature NOT IN ('priorities', 'client_deadline', 'aspect_ratio', 'production_links', 'custom_fields', 'subtasks',
                       'batch_videos', 'availability', 'assistant', 'calendar', 'workload', 'reports', 'production', 'tags', 'recurring', 'dependencies', 'time_tracking') THEN
    RAISE EXCEPTION 'unknown feature %', p_feature USING ERRCODE = '22023';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'a feature is switched on or off' USING ERRCODE = '22023';
  END IF;
  UPDATE public.workspaces
  SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{features}',
        CASE WHEN p_enabled THEN COALESCE(settings->'features', '{}'::jsonb) - p_feature
             ELSE COALESCE(settings->'features', '{}'::jsonb) || jsonb_build_object(p_feature, false) END, true),
      updated_at = NOW()
  WHERE id = p_workspace_id
  RETURNING settings->'features' INTO out;
  RETURN COALESCE(out, '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.set_workspace_feature(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_workspace_feature(UUID, TEXT, BOOLEAN) TO authenticated;

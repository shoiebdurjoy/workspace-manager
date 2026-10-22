-- Migration 30: tags, like ClickUp's (Settings > Customize workspace > Tags, and on every video).
--
--   tags       a workspace's tags: a name (unique per workspace, ignoring case, 1..40 characters), a colour, a
--              position. At most 100 per workspace. Readable by the staff; created, renamed, recoloured and
--              deleted by Owner / Admin / Production Manager.
--   task_tags  which tags a task carries. Added and removed by whoever may edit the task's fields (managers and QC
--              on any task, an editor on their own: private.can_attach_to_task, the same rule as custom fields).
--              The workspace is always taken from the task; a tag of another workspace is refused.
-- Deleting a tag removes it from every task. Client viewers see nothing. "tags" also becomes a feature switch.
--
-- Rollback: DROP TABLE public.task_tags; DROP TABLE public.tags; DROP FUNCTION public.guard_tag(), public.guard_task_tag();
--   restore set_workspace_feature() from migration 29.

CREATE TABLE public.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  color VARCHAR(7) NOT NULL DEFAULT '#64748B' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_tags_name ON public.tags(workspace_id, lower(btrim(name)));
CREATE INDEX idx_tags_order ON public.tags(workspace_id, position, created_at);

CREATE TABLE public.task_tags (
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX idx_task_tags_tag ON public.task_tags(tag_id);
CREATE INDEX idx_task_tags_workspace ON public.task_tags(workspace_id);

CREATE OR REPLACE FUNCTION public.guard_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.name := btrim(NEW.name);
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtext('tags:' || NEW.workspace_id::text));
    IF (SELECT count(*) FROM public.tags t WHERE t.workspace_id = NEW.workspace_id) >= 100 THEN
      RAISE EXCEPTION 'a workspace can have at most 100 tags' USING ERRCODE = '23514';
    END IF;
    NEW.created_at := NOW();
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'a tag cannot move to another workspace' USING ERRCODE = '42501';
    END IF;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_tag() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_tags_guard BEFORE INSERT OR UPDATE ON public.tags FOR EACH ROW EXECUTE FUNCTION public.guard_tag();

CREATE OR REPLACE FUNCTION public.guard_task_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ws UUID;
BEGIN
  SELECT workspace_id INTO ws FROM public.tasks WHERE id = NEW.task_id;
  IF ws IS NULL THEN
    RAISE EXCEPTION 'task % does not exist', NEW.task_id USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tags WHERE id = NEW.tag_id AND workspace_id = ws) THEN
    RAISE EXCEPTION 'that tag belongs to another workspace' USING ERRCODE = '23514';
  END IF;
  NEW.workspace_id := ws;
  NEW.created_at := NOW();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_task_tag() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_task_tags_guard BEFORE INSERT ON public.task_tags FOR EACH ROW EXECUTE FUNCTION public.guard_task_tag();

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tags_select" ON public.tags FOR SELECT TO authenticated USING (private.is_internal_member(workspace_id));
CREATE POLICY "tags_insert" ON public.tags FOR INSERT TO authenticated WITH CHECK (private.is_workspace_manager(workspace_id));
CREATE POLICY "tags_update" ON public.tags FOR UPDATE TO authenticated
  USING (private.is_workspace_manager(workspace_id)) WITH CHECK (private.is_workspace_manager(workspace_id));
CREATE POLICY "tags_delete" ON public.tags FOR DELETE TO authenticated USING (private.is_workspace_manager(workspace_id));

CREATE POLICY "task_tags_select" ON public.task_tags FOR SELECT TO authenticated USING (private.is_internal_member(workspace_id));
CREATE POLICY "task_tags_insert" ON public.task_tags FOR INSERT TO authenticated
  WITH CHECK (private.can_attach_to_task(task_id, (SELECT t.workspace_id FROM public.tasks t WHERE t.id = task_id)));
CREATE POLICY "task_tags_delete" ON public.task_tags FOR DELETE TO authenticated
  USING (private.can_attach_to_task(task_id, workspace_id));

GRANT SELECT, INSERT, DELETE ON TABLE public.tags TO authenticated;
GRANT UPDATE (name, color, position) ON TABLE public.tags TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.task_tags TO authenticated;
GRANT ALL ON TABLE public.tags, public.task_tags TO service_role;
REVOKE ALL ON TABLE public.tags, public.task_tags FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tags, public.task_tags FROM authenticated;

-- "tags" joins the feature switches
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
                       'batch_videos', 'availability', 'assistant', 'calendar', 'workload', 'reports', 'production', 'tags') THEN
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

-- ==============================================================================
-- Migration 21: list templates
-- ==============================================================================
-- "New client list in one click": a manager saves a list's standard videos as a template, and creates
-- new lists from it. A template keeps, per video: title, brief, priority, aspect ratio and its subtask
-- titles. It never copies people, dates, links, status, comments or files (a new list starts clean).
--
--   list_templates(id, workspace_id, name, description, items JSONB, created_by, created_at)
--   save_list_as_template(list, name, description)       SECURITY INVOKER (managers, by RLS)
--   create_list_from_template(template, space, folder, name, description, color) SECURITY INVOKER
--
--   * Read: internal staff. Write / delete: workspace managers (Owner, Admin, Production Manager).
--   * Limits: at most 100 videos per template, 50 subtasks per video, 30 templates per workspace.
--   * Videos placed under a batch (parent_id) are not copied; only top-level tasks are.
--   * create_list_from_template creates everything through the normal tables and create_task(), so every
--     guard, the activity log and the QC / workflow rules apply exactly as for hand-made tasks.
--
-- Rollback: DROP FUNCTION public.create_list_from_template(UUID, UUID, UUID, TEXT, TEXT, TEXT);
--           DROP FUNCTION public.save_list_as_template(UUID, TEXT, TEXT); DROP TABLE public.list_templates;
-- ==============================================================================

CREATE TABLE public.list_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 500),
  items JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 100),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_list_templates_name ON public.list_templates (workspace_id, lower(btrim(name)));

CREATE OR REPLACE FUNCTION public.guard_list_template()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  NEW.name := btrim(NEW.name);
  IF (SELECT count(*) FROM public.list_templates WHERE workspace_id = NEW.workspace_id) >= 30 THEN
    RAISE EXCEPTION 'a workspace can have at most 30 list templates' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_list_template() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_list_templates_guard BEFORE INSERT ON public.list_templates
  FOR EACH ROW EXECUTE FUNCTION public.guard_list_template();

ALTER TABLE public.list_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "list_templates_select" ON public.list_templates FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id));
CREATE POLICY "list_templates_insert" ON public.list_templates FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_manager(workspace_id));
CREATE POLICY "list_templates_delete" ON public.list_templates FOR DELETE TO authenticated
  USING (private.is_workspace_manager(workspace_id));
GRANT SELECT, INSERT, DELETE ON TABLE public.list_templates TO authenticated;
GRANT ALL ON TABLE public.list_templates TO service_role;
REVOKE ALL ON TABLE public.list_templates FROM anon;
REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.list_templates FROM authenticated;

-- ------------------------------------------------------------------------------
-- Save a list's standard videos as a template
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_list_as_template(p_list_id UUID, p_name TEXT, p_description TEXT DEFAULT NULL)
RETURNS public.list_templates
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  ws UUID;
  built JSONB;
  tpl public.list_templates;
BEGIN
  SELECT s.workspace_id INTO ws FROM public.lists l JOIN public.spaces s ON s.id = l.space_id WHERE l.id = p_list_id;
  IF ws IS NULL THEN
    RAISE EXCEPTION 'list not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(jsonb_agg(item ORDER BY pos, created), '[]'::jsonb) INTO built FROM (
    SELECT t.position AS pos, t.created_at AS created,
           jsonb_build_object(
             'title', t.title,
             'description', t.description,
             'priority', t.priority,
             'aspectRatio', t.aspect_ratio,
             'subtasks', COALESCE((SELECT jsonb_agg(st.title ORDER BY st.position, st.created_at)
                                   FROM (SELECT * FROM public.subtasks x WHERE x.task_id = t.id ORDER BY x.position, x.created_at LIMIT 50) st), '[]'::jsonb)
           ) AS item
    FROM public.tasks t
    WHERE t.list_id = p_list_id AND t.parent_id IS NULL
    ORDER BY t.position, t.created_at
    LIMIT 100
  ) q;
  INSERT INTO public.list_templates (workspace_id, name, description, items)
  VALUES (ws, p_name, NULLIF(btrim(COALESCE(p_description, '')), ''), built)
  RETURNING * INTO tpl;
  RETURN tpl;
END;
$$;
REVOKE ALL ON FUNCTION public.save_list_as_template(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_list_as_template(UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- Create a list, with its videos, from a template
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_list_from_template(
  p_template_id UUID,
  p_space_id UUID,
  p_folder_id UUID,
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_color TEXT DEFAULT NULL
)
RETURNS public.lists
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  tpl public.list_templates;
  new_list public.lists;
  item JSONB;
  new_task public.tasks;
  sub TEXT;
  n INT := 0;
  sn INT;
  next_pos INT;
BEGIN
  SELECT * INTO tpl FROM public.list_templates WHERE id = p_template_id;
  IF tpl.id IS NULL THEN
    RAISE EXCEPTION 'template not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(max(position), -1) + 1 INTO next_pos FROM public.lists
  WHERE space_id = p_space_id AND folder_id IS NOT DISTINCT FROM p_folder_id;

  INSERT INTO public.lists (space_id, folder_id, name, description, color, position)
  VALUES (p_space_id, p_folder_id, p_name, NULLIF(btrim(COALESCE(p_description, '')), ''), COALESCE(p_color, '#7B68EE'), next_pos)
  RETURNING * INTO new_list;

  IF new_list.workspace_id IS DISTINCT FROM tpl.workspace_id THEN
    RAISE EXCEPTION 'that template belongs to another workspace' USING ERRCODE = '42501';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(tpl.items) LOOP
    new_task := public.create_task(
      p_list_id := new_list.id,
      p_title := item ->> 'title',
      p_description := item ->> 'description',
      p_priority := COALESCE(item ->> 'priority', 'MEDIUM'),
      p_aspect_ratio := item ->> 'aspectRatio'
    );
    n := n + 1;
    sn := 0;
    FOR sub IN SELECT jsonb_array_elements_text(COALESCE(item -> 'subtasks', '[]'::jsonb)) LOOP
      INSERT INTO public.subtasks (task_id, title, position) VALUES (new_task.id, sub, sn);
      sn := sn + 1;
    END LOOP;
  END LOOP;
  RETURN new_list;
END;
$$;
REVOKE ALL ON FUNCTION public.create_list_from_template(UUID, UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_list_from_template(UUID, UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;

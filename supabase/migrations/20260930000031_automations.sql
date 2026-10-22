-- Migration 31: automations, like ClickUp's (Settings > Customize workspace > Automations).
--
-- An automation is WHEN <trigger> [IN <folder>] THEN <up to 5 actions>, created by Owner / Admin.
--   Triggers: a task is created; a task moves into a status (or any status); a tag is added to a task.
--   Actions:  set_priority {priority}      set_due_in_days {days 0..365}     add_tag {tag_id}
--             assign_editor {user_id}      assign_qc {user_id}               set_field {field_id, value}
--             notify {to: 'editor' | 'qc' | <member id>, message}
-- Automations run inside the database right after the change that triggers them, for whoever made it, so they
-- work the same from every screen and the built-in assistant. Each action is tried on its own: one that cannot
-- apply (a person who left, a tag that was deleted, a value that no longer fits) is skipped, never blocking the
-- change that triggered it. Changes made BY an automation never trigger further automations (no loops).
-- Managers can read automations (to know why something happened); only Owner / Admin create, edit or delete.
--
-- guard_task_update (migration 8) gains one exception: while an automation runs (a transaction-local flag only
-- this engine sets), its own priority / due-date change is not limited by the role of the person whose change
-- triggered it. The flag cannot be set through the API (set_config is not exposed).
--
-- Rollback: DROP TRIGGER trg_tasks_automation_created, trg_tasks_automation_status ON public.tasks;
--   DROP TRIGGER trg_task_tags_automation ON public.task_tags; DROP FUNCTION private.run_automations(UUID, TEXT, TEXT, UUID),
--   public.automation_on_task_insert(), public.automation_on_task_status(), public.automation_on_task_tag(),
--   public.guard_automation(); DROP TABLE public.automations; restore guard_task_update() from migration 8.

CREATE TABLE public.automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  enabled BOOLEAN NOT NULL DEFAULT true,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('task_created', 'status_changed', 'tag_added')),
  trigger_status TEXT,
  trigger_tag_id UUID REFERENCES public.tags(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
  actions JSONB NOT NULL,
  run_count INTEGER NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(actions) = 'array' AND jsonb_array_length(actions) BETWEEN 1 AND 5)
);
CREATE INDEX idx_automations_workspace ON public.automations(workspace_id, trigger_type) WHERE enabled;

CREATE OR REPLACE FUNCTION public.guard_automation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  a JSONB;
  t TEXT;
BEGIN
  -- the engine counting a run is not an edit: nothing to re-check
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - ARRAY['run_count', 'last_run_at']) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['run_count', 'last_run_at']) THEN
    RETURN NEW;
  END IF;
  NEW.name := btrim(NEW.name);
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtext('automations:' || NEW.workspace_id::text));
    IF (SELECT count(*) FROM public.automations WHERE workspace_id = NEW.workspace_id) >= 50 THEN
      RAISE EXCEPTION 'a workspace can have at most 50 automations' USING ERRCODE = '23514';
    END IF;
    NEW.created_by := auth.uid();
    NEW.created_at := NOW();
    NEW.run_count := 0;
    NEW.last_run_at := NULL;
  ELSE
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'an automation cannot move to another workspace' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.run_count := OLD.run_count;
    NEW.last_run_at := OLD.last_run_at;
  END IF;
  IF NEW.trigger_type = 'tag_added' AND NEW.trigger_tag_id IS NULL THEN
    RAISE EXCEPTION 'pick the tag that starts this automation' USING ERRCODE = '23514';
  END IF;
  IF NEW.folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.folders WHERE id = NEW.folder_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'that folder belongs to another workspace' USING ERRCODE = '23514';
  END IF;
  IF NEW.trigger_tag_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tags WHERE id = NEW.trigger_tag_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'that tag belongs to another workspace' USING ERRCODE = '23514';
  END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(NEW.actions) LOOP
    t := a->>'type';
    IF t IS NULL OR t NOT IN ('set_priority', 'set_due_in_days', 'add_tag', 'assign_editor', 'assign_qc', 'set_field', 'notify') THEN
      RAISE EXCEPTION 'unknown action %', COALESCE(t, '(none)') USING ERRCODE = '23514';
    END IF;
    IF t = 'set_priority' AND COALESCE(a->>'priority', '') NOT IN ('URGENT', 'HIGH', 'MEDIUM', 'LOW') THEN
      RAISE EXCEPTION 'set priority needs URGENT, HIGH, MEDIUM or LOW' USING ERRCODE = '23514';
    END IF;
    IF t = 'set_due_in_days' AND (jsonb_typeof(a->'days') <> 'number' OR (a->>'days')::numeric NOT BETWEEN 0 AND 365) THEN
      RAISE EXCEPTION 'set due date needs a number of days from 0 to 365' USING ERRCODE = '23514';
    END IF;
    IF t IN ('add_tag') AND NOT EXISTS (SELECT 1 FROM public.tags WHERE id::text = a->>'tag_id' AND workspace_id = NEW.workspace_id) THEN
      RAISE EXCEPTION 'add tag needs a tag of this workspace' USING ERRCODE = '23514';
    END IF;
    IF t IN ('assign_editor', 'assign_qc') AND NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE user_id::text = a->>'user_id' AND workspace_id = NEW.workspace_id) THEN
      RAISE EXCEPTION 'assign needs a member of this workspace' USING ERRCODE = '23514';
    END IF;
    IF t = 'set_field' AND NOT EXISTS (SELECT 1 FROM public.custom_fields WHERE id::text = a->>'field_id' AND workspace_id = NEW.workspace_id) THEN
      RAISE EXCEPTION 'set field needs a field of this workspace' USING ERRCODE = '23514';
    END IF;
    IF t = 'notify' AND (COALESCE(char_length(a->>'message'), 0) NOT BETWEEN 1 AND 300
        OR NOT (a->>'to' IN ('editor', 'qc') OR EXISTS (SELECT 1 FROM public.workspace_members WHERE user_id::text = a->>'to' AND workspace_id = NEW.workspace_id))) THEN
      RAISE EXCEPTION 'notify needs who (editor, qc or a member) and a message of 1 to 300 characters' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_automation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_automations_guard BEFORE INSERT OR UPDATE ON public.automations FOR EACH ROW EXECUTE FUNCTION public.guard_automation();

ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "automations_select" ON public.automations FOR SELECT TO authenticated USING (private.is_workspace_manager(workspace_id));
CREATE POLICY "automations_insert" ON public.automations FOR INSERT TO authenticated WITH CHECK (private.is_workspace_admin(workspace_id));
CREATE POLICY "automations_update" ON public.automations FOR UPDATE TO authenticated
  USING (private.is_workspace_admin(workspace_id)) WITH CHECK (private.is_workspace_admin(workspace_id));
CREATE POLICY "automations_delete" ON public.automations FOR DELETE TO authenticated USING (private.is_workspace_admin(workspace_id));
GRANT SELECT, DELETE ON TABLE public.automations TO authenticated;
GRANT INSERT (workspace_id, name, enabled, trigger_type, trigger_status, trigger_tag_id, folder_id, actions) ON TABLE public.automations TO authenticated;
GRANT UPDATE (name, enabled, trigger_type, trigger_status, trigger_tag_id, folder_id, actions) ON TABLE public.automations TO authenticated;
GRANT ALL ON TABLE public.automations TO service_role;
REVOKE ALL ON TABLE public.automations FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.automations FROM authenticated;

-- ------------------------------------------------------------------------------------------------
-- The engine
-- ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.run_automations(p_task UUID, p_event TEXT, p_status TEXT, p_tag UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  tk RECORD;
  au RECORD;
  a JSONB;
  target UUID;
  ran BOOLEAN;
BEGIN
  -- a change made by an automation never starts another one
  IF current_setting('tbb.automation', true) = 'on' THEN
    RETURN;
  END IF;
  SELECT t.id, t.workspace_id, l.folder_id INTO tk FROM public.tasks t JOIN public.lists l ON l.id = t.list_id WHERE t.id = p_task;
  IF tk.id IS NULL THEN
    RETURN;
  END IF;
  FOR au IN
    SELECT * FROM public.automations
    WHERE workspace_id = tk.workspace_id AND enabled AND trigger_type = p_event
      AND (folder_id IS NULL OR folder_id = tk.folder_id)
      AND (p_event <> 'status_changed' OR trigger_status IS NULL OR trigger_status = p_status)
      AND (p_event <> 'tag_added' OR trigger_tag_id = p_tag)
    ORDER BY created_at
  LOOP
    PERFORM set_config('tbb.automation', 'on', true);
    ran := false;
    FOR a IN SELECT * FROM jsonb_array_elements(au.actions) LOOP
      BEGIN
        CASE a->>'type'
          WHEN 'set_priority' THEN
            UPDATE public.tasks SET priority = a->>'priority' WHERE id = p_task;
          WHEN 'set_due_in_days' THEN
            UPDATE public.tasks SET due_date = date_trunc('day', NOW()) + make_interval(days => (a->>'days')::int) + interval '12 hours' WHERE id = p_task;
          WHEN 'add_tag' THEN
            INSERT INTO public.task_tags (task_id, tag_id) VALUES (p_task, (a->>'tag_id')::uuid) ON CONFLICT DO NOTHING;
          WHEN 'assign_editor' THEN
            INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES (p_task, 'EDITOR', (a->>'user_id')::uuid)
            ON CONFLICT (task_id, role_type) DO UPDATE SET user_id = EXCLUDED.user_id;
          WHEN 'assign_qc' THEN
            INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES (p_task, 'QC_REVIEWER', (a->>'user_id')::uuid)
            ON CONFLICT (task_id, role_type) DO UPDATE SET user_id = EXCLUDED.user_id;
          WHEN 'set_field' THEN
            INSERT INTO public.custom_field_values (task_id, field_id, workspace_id, value) VALUES (p_task, (a->>'field_id')::uuid, tk.workspace_id, a->'value')
            ON CONFLICT (task_id, field_id) DO UPDATE SET value = EXCLUDED.value;
          WHEN 'notify' THEN
            target := CASE a->>'to'
              WHEN 'editor' THEN (SELECT user_id FROM public.task_assignees WHERE task_id = p_task AND role_type = 'EDITOR')
              WHEN 'qc' THEN (SELECT user_id FROM public.task_assignees WHERE task_id = p_task AND role_type = 'QC_REVIEWER')
              ELSE (a->>'to')::uuid END;
            IF target IS NOT NULL AND target IS DISTINCT FROM auth.uid() THEN
              INSERT INTO public.notifications (user_id, workspace_id, task_id, actor_id, kind, data, dedupe_key)
              VALUES (target, tk.workspace_id, p_task, auth.uid(), 'status',
                      jsonb_build_object('automation', au.name, 'message', a->>'message', 'to', p_status),
                      left('auto:' || au.id::text || ':' || p_task::text || ':' || extract(epoch FROM clock_timestamp())::text, 200))
              ON CONFLICT DO NOTHING;
            END IF;
          ELSE
            NULL;
        END CASE;
        ran := true;
      EXCEPTION WHEN OTHERS THEN
        -- an action that cannot apply is skipped; the change that triggered it still succeeds
        NULL;
      END;
    END LOOP;
    PERFORM set_config('tbb.automation', 'off', true);
    IF ran THEN
      UPDATE public.automations SET run_count = run_count + 1, last_run_at = NOW() WHERE id = au.id;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.run_automations(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.automation_on_task_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.run_automations(NEW.id, 'task_created', NEW.status, NULL);
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.automation_on_task_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM private.run_automations(NEW.id, 'status_changed', NEW.status, NULL);
  END IF;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.automation_on_task_tag()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.run_automations(NEW.task_id, 'tag_added', NULL, NEW.tag_id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.automation_on_task_insert(), public.automation_on_task_status(), public.automation_on_task_tag() FROM PUBLIC, anon, authenticated;

-- "zz" so they run after the field defaults, QC auto-assign and the other AFTER triggers
CREATE TRIGGER trg_tasks_zz_automation_created AFTER INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.automation_on_task_insert();
CREATE TRIGGER trg_tasks_zz_automation_status AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.automation_on_task_status();
CREATE TRIGGER trg_task_tags_zz_automation AFTER INSERT ON public.task_tags FOR EACH ROW EXECUTE FUNCTION public.automation_on_task_tag();

-- an automation's own priority / due-date change is not limited by the role of whoever triggered it
CREATE OR REPLACE FUNCTION public.guard_task_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r TEXT;
  allowed TEXT[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF current_setting('tbb.automation', true) = 'on'
     AND (to_jsonb(NEW) - ARRAY['priority', 'due_date', 'updated_at']) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['priority', 'due_date', 'updated_at']) THEN
    RETURN NEW;
  END IF;

  r := private.workspace_role(OLD.workspace_id);

  IF r IN ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER') THEN
    RETURN NEW;
  END IF;

  IF r = 'QC_SPECIALIST' THEN
    -- QC delivers to the client, so it may attach the final export
    allowed := ARRAY['status', 'position', 'final_export_link', 'revision_count', 'updated_at'];
  ELSIF r = 'EDITOR' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.task_assignees a
      WHERE a.task_id = OLD.id AND a.role_type = 'EDITOR' AND a.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'editors can only update tasks that are assigned to them'
        USING ERRCODE = '42501';
    END IF;
    allowed := ARRAY['status', 'position', 'review_link', 'project_file_link', 'revision_count', 'updated_at'];
  ELSE
    RAISE EXCEPTION 'your role cannot modify tasks' USING ERRCODE = '42501';
  END IF;

  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'your role may only change %',
      array_to_string(ARRAY(SELECT x FROM unnest(allowed) x WHERE x NOT IN ('updated_at', 'revision_count')), ', ')
      USING ERRCODE = '42501';
  END IF;

  -- which status moves are allowed is decided by enforce_task_workflow
  RETURN NEW;
END;
$$;

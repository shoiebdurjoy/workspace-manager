-- Migration 39: the trash. Every delete can be traced (who, what, when) and undone by a manager.
--
-- Whenever a space, folder, list, video or one of their parts is deleted (directly or because its parent was), the
-- row is copied into trash_items before it disappears, with who deleted it and when. Everything removed by one
-- action shares a batch (the transaction), so deleting a client list puts the list AND all its videos, comments,
-- fields, tags, time and history in one batch, restored together.
-- Owner / Admin / Production Manager see the trash of their workspace and restore a batch (Settings > Trash).
-- Restoring re-inserts the rows exactly as they were (same ids, statuses, revision counts, authors, dates) without
-- sending notifications, running automations or crediting production again. A row whose parent is gone (say, a
-- video whose list was deleted separately and not restored) is skipped and counted.
-- The trash keeps 30 days. Deleting a whole workspace is not trashed. Uploaded files of a deleted attachment stay in
-- storage, so a restored attachment opens again.
-- Restore runs as private.restore_trash (not reachable from the API) behind public.restore_trash_batch, which runs
-- with the caller's rights; so no SECURITY DEFINER function is exposed.
--
-- Rollback: DROP TRIGGER trg_trash_capture ON each table below; DROP FUNCTION public.restore_trash_batch(BIGINT, UUID),
--   private.restore_trash(BIGINT, UUID), private.capture_deleted(); DROP TABLE public.trash_items; restore the
--   functions redefined at the end from their migrations (8, 9, 28, 31, 34, 38).

CREATE TABLE public.trash_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch BIGINT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  item_id TEXT,
  label TEXT,
  row_data JSONB NOT NULL,
  deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ,
  restored_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX idx_trash_items_workspace ON public.trash_items(workspace_id, deleted_at DESC);
CREATE INDEX idx_trash_items_batch ON public.trash_items(workspace_id, batch);

ALTER TABLE public.trash_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trash_items_select" ON public.trash_items FOR SELECT TO authenticated USING (private.is_workspace_manager(workspace_id));
GRANT SELECT ON TABLE public.trash_items TO authenticated;
GRANT ALL ON TABLE public.trash_items TO service_role;
REVOKE ALL ON TABLE public.trash_items FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.trash_items FROM authenticated;

CREATE OR REPLACE FUNCTION private.capture_deleted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r JSONB := to_jsonb(OLD);
  ws UUID := (r->>'workspace_id')::uuid;
BEGIN
  -- a workspace being deleted takes everything with it; nothing to keep
  IF ws IS NULL OR NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = ws) THEN
    RETURN OLD;
  END IF;
  INSERT INTO public.trash_items (batch, workspace_id, table_name, item_id, label, row_data, deleted_by)
  VALUES (txid_current(), ws, TG_TABLE_NAME, COALESCE(r->>'id', r->>'task_id'),
          left(COALESCE(r->>'title', r->>'name', r->>'body', r->>'file_name', r->>'note', ''), 200), r, auth.uid());
  -- keep 30 days (cleaned a little at a time)
  IF random() < 0.02 THEN
    DELETE FROM public.trash_items WHERE deleted_at < NOW() - interval '30 days';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION private.capture_deleted() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_trash_capture ON public.spaces;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.spaces FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.folders;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.folders FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.lists;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.lists FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.tasks;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.tasks FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.custom_fields;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.custom_fields FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.tags;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.tags FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.task_assignees;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.task_assignees FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.subtasks;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.subtasks FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.custom_field_values;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.custom_field_values FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.task_tags;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.task_tags FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.task_comments;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.task_comments FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.task_attachments;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.task_attachments FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.task_dependencies;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.task_dependencies FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.task_recurrence;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.task_recurrence FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.task_production_credits;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.task_production_credits FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.task_status_events;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.task_status_events FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.task_activity;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.task_activity FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.time_entries;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.time_entries FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.automations;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.automations FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.brief_forms;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.brief_forms FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();
DROP TRIGGER IF EXISTS trg_trash_capture ON public.saved_views;
CREATE TRIGGER trg_trash_capture BEFORE DELETE ON public.saved_views FOR EACH ROW EXECUTE FUNCTION private.capture_deleted();

CREATE OR REPLACE FUNCTION private.restore_trash(p_batch BIGINT, p_workspace_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  me UUID := auth.uid();
  sub TEXT := current_setting('request.jwt.claim.sub', true);
  claims TEXT := current_setting('request.jwt.claims', true);
  item RECORD;
  tbl TEXT;
  restored INT := 0;
  skipped INT := 0;
  ok BOOLEAN;
BEGIN
  IF me IS NULL OR NOT private.is_workspace_manager(p_workspace_id) THEN
    RAISE EXCEPTION 'only owners, admins and production managers can restore' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trash_items WHERE workspace_id = p_workspace_id AND batch = p_batch AND restored_at IS NULL) THEN
    RAISE EXCEPTION 'nothing to restore in that batch' USING ERRCODE = 'P0002';
  END IF;
  -- re-insert as the system (no role limits), with side effects switched off
  PERFORM set_config('tbb.restore', 'on', true);
  -- auth.uid() reads either setting, depending on the API version
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  FOREACH tbl IN ARRAY ARRAY['spaces', 'folders', 'lists', 'tasks', 'custom_fields', 'tags', 'task_assignees', 'subtasks', 'custom_field_values', 'task_tags', 'task_comments', 'task_attachments', 'task_dependencies', 'task_recurrence', 'task_production_credits', 'task_status_events', 'task_activity', 'time_entries', 'automations', 'brief_forms', 'saved_views'] LOOP
    FOR item IN
      SELECT * FROM public.trash_items
      WHERE workspace_id = p_workspace_id AND batch = p_batch AND restored_at IS NULL AND table_name = tbl
      -- a batch video before its child videos
      ORDER BY (row_data->>'parent_id') IS NOT NULL, deleted_at
    LOOP
      ok := true;
      BEGIN
        IF tbl = 'custom_field_values' THEN
          EXECUTE format('INSERT INTO public.%I SELECT * FROM jsonb_populate_record(NULL::public.%I, $1) ON CONFLICT (task_id, field_id) DO UPDATE SET value = EXCLUDED.value', tbl, tbl) USING item.row_data;
        ELSE
          EXECUTE format('INSERT INTO public.%I SELECT * FROM jsonb_populate_record(NULL::public.%I, $1) ON CONFLICT DO NOTHING', tbl, tbl) USING item.row_data;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        ok := false;
      END;
      IF ok THEN
        restored := restored + 1;
        UPDATE public.trash_items SET restored_at = NOW(), restored_by = me WHERE id = item.id;
      ELSE
        skipped := skipped + 1;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', COALESCE(sub, ''), true);
  PERFORM set_config('request.jwt.claims', COALESCE(claims, ''), true);
  PERFORM set_config('tbb.restore', 'off', true);
  RETURN jsonb_build_object('restored', restored, 'skipped', skipped);
END;
$$;
REVOKE ALL ON FUNCTION private.restore_trash(BIGINT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.restore_trash(BIGINT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_trash_batch(p_batch BIGINT, p_workspace_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.restore_trash(p_batch, p_workspace_id)
$$;
REVOKE ALL ON FUNCTION public.restore_trash_batch(BIGINT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_trash_batch(BIGINT, UUID) TO authenticated;

-- ------------------------------------------------------------------------------------------------
-- The side-effect triggers learn to stay quiet while a restore runs
-- ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_task_workflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  wf UUID;
  target public.workflow_statuses;
  initial_key TEXT;
  r TEXT;
  edge_roles TEXT[];
  note TEXT;
  from_name TEXT;
BEGIN
  -- revision_count is never set by a client: only the workflow moves it
  IF TG_OP = 'INSERT' AND current_setting('tbb.restore', true) = 'on' THEN
    NULL; -- a task restored from the trash keeps its revision count
  ELSIF TG_OP = 'INSERT' THEN
    NEW.revision_count := 0;
  ELSE
    NEW.revision_count := OLD.revision_count;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  wf := private.task_workflow_id(NEW.workspace_id);
  IF wf IS NULL THEN
    RAISE EXCEPTION 'this workspace has no workflow' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO target FROM public.workflow_statuses WHERE workflow_id = wf AND key = NEW.status;
  IF target.key IS NULL THEN
    RAISE EXCEPTION 'unknown status %', NEW.status USING ERRCODE = '23514';
  END IF;

  -- service role / SQL editor / migrations: any known status, no role rules
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'UPDATE' AND target.counts_revision THEN
      NEW.revision_count := OLD.revision_count + 1;
    END IF;
    RETURN NEW;
  END IF;

  r := private.workspace_role(NEW.workspace_id);

  IF TG_OP = 'INSERT' THEN
    SELECT key INTO initial_key FROM public.workflow_statuses WHERE workflow_id = wf AND is_initial;
    IF NEW.status <> initial_key AND r NOT IN ('OWNER', 'ADMIN') THEN
      RAISE EXCEPTION 'new tasks start at %', (SELECT name FROM public.workflow_statuses WHERE workflow_id = wf AND key = initial_key)
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE with a status change: must be an edge this role may take (OWNER / ADMIN may override)
  SELECT roles INTO edge_roles FROM public.workflow_transitions
  WHERE workflow_id = wf AND from_key = OLD.status AND to_key = NEW.status;
  IF (edge_roles IS NULL OR NOT (r = ANY (edge_roles))) AND r NOT IN ('OWNER', 'ADMIN') THEN
    SELECT name INTO from_name FROM public.workflow_statuses WHERE workflow_id = wf AND key = OLD.status;
    IF edge_roles IS NULL THEN
      RAISE EXCEPTION 'a task cannot move from % to %', COALESCE(from_name, OLD.status), target.name USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'your role cannot move a task from % to %', COALESCE(from_name, OLD.status), target.name USING ERRCODE = '42501';
  END IF;

  -- what the target stage needs (also for overrides: the data must make sense)
  IF target.requires_editor AND NOT EXISTS (
    SELECT 1 FROM public.task_assignees a WHERE a.task_id = NEW.id AND a.role_type = 'EDITOR'
  ) THEN
    RAISE EXCEPTION '% needs an editor assigned first', target.name USING ERRCODE = '23514';
  END IF;
  IF target.requires_review_link AND NEW.review_link IS NULL THEN
    RAISE EXCEPTION '% needs the review link of the cut', target.name USING ERRCODE = '23514';
  END IF;
  IF target.requires_final_export AND NEW.final_export_link IS NULL THEN
    RAISE EXCEPTION '% needs the final export link', target.name USING ERRCODE = '23514';
  END IF;
  IF target.requires_note THEN
    note := NULLIF(btrim(COALESCE(current_setting('tbb.transition_note', true), '')), '');
    IF note IS NULL THEN
      RAISE EXCEPTION '% needs a note explaining what to change', target.name USING ERRCODE = '23514';
    END IF;
  END IF;

  IF target.counts_revision THEN
    NEW.revision_count := OLD.revision_count + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_task_status_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  wf UUID;
  r TEXT;
  allowed BOOLEAN := true;
  note TEXT;
BEGIN
  -- restoring from the trash re-inserts history as it was: no new side effects
  IF current_setting('tbb.restore', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  note := NULLIF(btrim(COALESCE(current_setting('tbb.transition_note', true), '')), '');
  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL THEN
    wf := private.task_workflow_id(NEW.workspace_id);
    r := private.workspace_role(NEW.workspace_id);
    allowed := EXISTS (
      SELECT 1 FROM public.workflow_transitions
      WHERE workflow_id = wf AND from_key = OLD.status AND to_key = NEW.status AND r = ANY (roles)
    );
  END IF;
  INSERT INTO public.task_status_events (task_id, workspace_id, from_status, to_status, actor_id, note, is_override, revision_number)
  VALUES (
    NEW.id, NEW.workspace_id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
    NEW.status, auth.uid(),
    CASE WHEN TG_OP = 'UPDATE' THEN LEFT(note, 2000) END,
    NOT allowed,
    CASE WHEN TG_OP = 'UPDATE' AND NEW.revision_count > OLD.revision_count THEN NEW.revision_count END
  );
  -- a note belongs to exactly one change
  PERFORM set_config('tbb.transition_note', '', true);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_production_credit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- restoring from the trash re-inserts history as it was: no new side effects
  IF current_setting('tbb.restore', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'production credits are permanent and cannot be changed' USING ERRCODE = '42501';
  END IF;
  -- depth 1 = a direct DELETE; a workspace deletion reaches here through the FK cascade (depth > 1)
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'production credits are permanent and cannot be deleted' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_production_credit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ed UUID;
BEGIN
  -- restoring from the trash re-inserts history as it was: no new side effects
  IF current_setting('tbb.restore', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workflow_statuses s
    WHERE s.workflow_id = private.task_workflow_id(NEW.workspace_id) AND s.key = NEW.status AND s.credits_production
  ) THEN
    RETURN NULL;
  END IF;
  SELECT a.user_id INTO ed FROM public.task_assignees a WHERE a.task_id = NEW.id AND a.role_type = 'EDITOR';
  IF ed IS NULL THEN
    RETURN NULL; -- the stage requires an editor, so this does not happen; never credit nobody
  END IF;
  -- the first submission wins forever: a re-submission after a revision is not a new credit
  INSERT INTO public.task_production_credits (task_id, workspace_id, editor_id, first_qc_submitted_at, submitted_by)
  VALUES (NEW.id, NEW.workspace_id, ed, NOW(), auth.uid())
  ON CONFLICT (task_id) DO NOTHING;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_field_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  f RECORD;
  folder UUID;
BEGIN
  -- restoring from the trash re-inserts history as it was: no new side effects
  IF current_setting('tbb.restore', true) = 'on' THEN
    RETURN NULL;
  END IF;
  SELECT l.folder_id INTO folder FROM public.lists l WHERE l.id = NEW.list_id;
  FOR f IN
    SELECT id, default_value FROM public.custom_fields
    WHERE workspace_id = NEW.workspace_id AND default_value IS NOT NULL AND jsonb_typeof(default_value) <> 'null'
      AND (folder_ids IS NULL OR folder = ANY (folder_ids))
  LOOP
    BEGIN
      INSERT INTO public.custom_field_values (task_id, field_id, workspace_id, value)
      VALUES (NEW.id, f.id, NEW.workspace_id, f.default_value)
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
  RETURN NULL;
END;
$$;

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
  -- restoring from the trash re-inserts history as it was: no new side effects
  IF current_setting('tbb.restore', true) = 'on' THEN
    RETURN;
  END IF;
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

CREATE OR REPLACE FUNCTION public.apply_notification_prefs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p RECORD;
  kind TEXT := CASE WHEN NEW.kind = 'status' AND NEW.data ? 'automation' THEN 'automation' ELSE NEW.kind END;
BEGIN
  -- restoring from the trash re-inserts history as it was: no new side effects
  IF current_setting('tbb.restore', true) = 'on' THEN
    RETURN NULL;
  END IF;
  SELECT muted_kinds, muted_list_ids INTO p FROM public.notification_prefs WHERE user_id = NEW.user_id AND workspace_id = NEW.workspace_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF kind = ANY (p.muted_kinds) THEN
    RETURN NULL;
  END IF;
  IF cardinality(p.muted_list_ids) > 0 AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = NEW.task_id AND t.list_id = ANY (p.muted_list_ids)) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_time_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_setting('tbb.restore', true) IS DISTINCT FROM 'on' THEN
      NEW.user_id := auth.uid();
    END IF;
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

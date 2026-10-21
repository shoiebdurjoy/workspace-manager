-- ==============================================================================
-- Migration 17: custom fields (Phase 12, first slice)
-- ==============================================================================
-- Per-workspace extra fields on tasks, for what TBB's real work carries and the task table does not
-- ("Link to the Raw Video", "Brand Guidelines", "HOOK VARIATION", "Video Format Needed", ...). Nothing
-- about tasks, search_tasks or create_task changes: this is purely additive.
--
--   * custom_fields: the DEFINITIONS. A name (unique per workspace, ignoring case), a type (text, url,
--     number, dropdown, date), the choices of a dropdown, and a position. At most 50 per workspace.
--     Readable by the staff; created, renamed, re-ordered and deleted by Owner / Admin / Production Manager.
--     The TYPE can never be changed after creation (that would silently invalidate every stored value).
--   * custom_field_values: one row per (task, field) that has a value. An empty field has NO row (clients
--     delete instead of storing null). Readable by the staff; written by the managers and QC on any task and
--     by an Editor only on the tasks assigned to them (the same rule as attaching files,
--     private.can_attach_to_task). Client viewers see nothing.
--   * The value is checked against the field's type HERE, whatever the client sends: text is a string up to
--     2000 characters, url an http(s) link up to 2048, number a finite number, dropdown one of the field's
--     choices, date a real calendar date written YYYY-MM-DD. The workspace is always taken from the task,
--     the editor is always the signed-in person and the time is the server's.
--   * Deleting a field deletes its values; deleting a task deletes its values.
--   * Editing the choices of a dropdown never rewrites stored values: removing a choice that is in use leaves
--     those values readable as they are (they simply are no longer on the list). They are checked again only
--     when someone changes that value.
--
-- Rollback (loses every definition and value):
--   DROP TABLE public.custom_field_values; DROP TABLE public.custom_fields;
--   DROP FUNCTION public.guard_custom_field(), public.guard_custom_field_value(), private.valid_field_options(JSONB);
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Definitions
-- ------------------------------------------------------------------------------

-- The choices of a dropdown: 1 to 30 distinct, non-empty strings of at most 60 characters.
CREATE OR REPLACE FUNCTION private.valid_field_options(opts JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(opts) = 'array'
     AND jsonb_array_length(opts) BETWEEN 1 AND 30
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(opts) e
       WHERE jsonb_typeof(e) <> 'string' OR char_length(btrim(e #>> '{}')) NOT BETWEEN 1 AND 60
     )
     AND (SELECT count(DISTINCT e) FROM jsonb_array_elements(opts) e) = jsonb_array_length(opts)
$$;
REVOKE ALL ON FUNCTION private.valid_field_options(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.valid_field_options(JSONB) TO authenticated, service_role;

CREATE TABLE public.custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60 AND char_length(btrim(name)) >= 1),
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'url', 'number', 'dropdown', 'date')),
  options JSONB,
  position INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT custom_fields_options_match_type CHECK (
    (field_type = 'dropdown' AND options IS NOT NULL AND private.valid_field_options(options))
    OR (field_type <> 'dropdown' AND options IS NULL)
  )
);

CREATE UNIQUE INDEX idx_custom_fields_name ON public.custom_fields(workspace_id, lower(name));
CREATE INDEX idx_custom_fields_order ON public.custom_fields(workspace_id, position, created_at);

CREATE OR REPLACE FUNCTION public.guard_custom_field()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- serialise inserts per workspace so the limit cannot be beaten by two at once
    PERFORM pg_advisory_xact_lock(hashtext('custom_fields:' || NEW.workspace_id::text));
    IF (SELECT count(*) FROM public.custom_fields f WHERE f.workspace_id = NEW.workspace_id) >= 50 THEN
      RAISE EXCEPTION 'a workspace can have at most 50 custom fields' USING ERRCODE = '23514';
    END IF;
    IF auth.uid() IS NOT NULL THEN
      NEW.created_by := auth.uid();
    END IF;
    NEW.created_at := NOW();
  ELSE
    IF NEW.field_type IS DISTINCT FROM OLD.field_type THEN
      RAISE EXCEPTION 'the type of a custom field cannot be changed; create a new field instead' USING ERRCODE = '42501';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'a custom field cannot move' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_custom_field() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_custom_fields_guard BEFORE INSERT OR UPDATE ON public.custom_fields
  FOR EACH ROW EXECUTE FUNCTION public.guard_custom_field();

ALTER TABLE public.custom_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "custom_fields_select" ON public.custom_fields FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id));

CREATE POLICY "custom_fields_insert" ON public.custom_fields FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_manager(workspace_id));

CREATE POLICY "custom_fields_update" ON public.custom_fields FOR UPDATE TO authenticated
  USING (private.is_workspace_manager(workspace_id))
  WITH CHECK (private.is_workspace_manager(workspace_id));

CREATE POLICY "custom_fields_delete" ON public.custom_fields FOR DELETE TO authenticated
  USING (private.is_workspace_manager(workspace_id));

GRANT SELECT, INSERT, DELETE ON TABLE public.custom_fields TO authenticated;
GRANT UPDATE (name, options, position) ON TABLE public.custom_fields TO authenticated;
GRANT ALL ON TABLE public.custom_fields TO service_role;
REVOKE ALL ON TABLE public.custom_fields FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.custom_fields FROM authenticated;

-- ------------------------------------------------------------------------------
-- 2. Values
-- ------------------------------------------------------------------------------

CREATE TABLE public.custom_field_values (
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES public.custom_fields(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, field_id)
);

CREATE INDEX idx_custom_field_values_field ON public.custom_field_values(field_id);
CREATE INDEX idx_custom_field_values_workspace ON public.custom_field_values(workspace_id);

CREATE OR REPLACE FUNCTION public.guard_custom_field_value()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ws UUID;
  f RECORD;
  v JSONB := NEW.value;
  s TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.field_id IS DISTINCT FROM OLD.field_id
       OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'a field value cannot move to another task or field' USING ERRCODE = '42501';
    END IF;
    -- only a CHANGED value is checked, so a choice that was later removed does not block unrelated updates
    -- (for example the foreign key that blanks updated_by when an account is deleted)
    IF NEW.value IS NOT DISTINCT FROM OLD.value THEN
      RETURN NEW;
    END IF;
    NEW.updated_by := auth.uid();
    NEW.updated_at := NOW();
  END IF;

  SELECT t.workspace_id INTO ws FROM public.tasks t WHERE t.id = NEW.task_id;
  IF ws IS NULL THEN
    RAISE EXCEPTION 'task % does not exist', NEW.task_id USING ERRCODE = '23503';
  END IF;
  SELECT cf.workspace_id, cf.field_type, cf.options, cf.name INTO f FROM public.custom_fields cf WHERE cf.id = NEW.field_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'field % does not exist', NEW.field_id USING ERRCODE = '23503';
  END IF;
  IF f.workspace_id IS DISTINCT FROM ws THEN
    RAISE EXCEPTION 'that field belongs to another workspace' USING ERRCODE = '23514';
  END IF;
  NEW.workspace_id := ws;
  IF TG_OP = 'INSERT' THEN
    NEW.updated_by := auth.uid();
    NEW.updated_at := NOW();
  END IF;

  IF v IS NULL OR jsonb_typeof(v) = 'null' THEN
    RAISE EXCEPTION 'an empty value is not stored; delete the value instead' USING ERRCODE = '23514';
  END IF;
  s := v #>> '{}';

  IF f.field_type = 'text' THEN
    IF jsonb_typeof(v) <> 'string' OR char_length(s) NOT BETWEEN 1 AND 2000 THEN
      RAISE EXCEPTION '% must be text of 1 to 2000 characters', f.name USING ERRCODE = '23514';
    END IF;
  ELSIF f.field_type = 'url' THEN
    IF jsonb_typeof(v) <> 'string' OR char_length(s) > 2048 OR s !~* '^https?://[^[:space:]/?#]+([/?#][^[:space:]]*)?$' THEN
      RAISE EXCEPTION '% must be an http(s) link of at most 2048 characters', f.name USING ERRCODE = '23514';
    END IF;
  ELSIF f.field_type = 'number' THEN
    IF jsonb_typeof(v) <> 'number' THEN
      RAISE EXCEPTION '% must be a number', f.name USING ERRCODE = '23514';
    END IF;
  ELSIF f.field_type = 'dropdown' THEN
    IF jsonb_typeof(v) <> 'string' OR f.options IS NULL OR NOT (f.options @> v) THEN
      RAISE EXCEPTION '% must be one of its choices', f.name USING ERRCODE = '23514';
    END IF;
  ELSIF f.field_type = 'date' THEN
    IF jsonb_typeof(v) <> 'string' OR s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION '% must be a date written YYYY-MM-DD', f.name USING ERRCODE = '23514';
    END IF;
    BEGIN
      IF to_char(s::date, 'YYYY-MM-DD') <> s THEN
        RAISE EXCEPTION 'bad date';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '% must be a real calendar date', f.name USING ERRCODE = '23514';
    END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_custom_field_value() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_custom_field_values_guard BEFORE INSERT OR UPDATE ON public.custom_field_values
  FOR EACH ROW EXECUTE FUNCTION public.guard_custom_field_value();

ALTER TABLE public.custom_field_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "custom_field_values_select" ON public.custom_field_values FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id));

CREATE POLICY "custom_field_values_insert" ON public.custom_field_values FOR INSERT TO authenticated
  WITH CHECK (private.can_attach_to_task(task_id, workspace_id));

CREATE POLICY "custom_field_values_update" ON public.custom_field_values FOR UPDATE TO authenticated
  USING (private.can_attach_to_task(task_id, workspace_id))
  WITH CHECK (private.can_attach_to_task(task_id, workspace_id));

CREATE POLICY "custom_field_values_delete" ON public.custom_field_values FOR DELETE TO authenticated
  USING (private.can_attach_to_task(task_id, workspace_id));

GRANT SELECT, INSERT, DELETE ON TABLE public.custom_field_values TO authenticated;
GRANT UPDATE (value) ON TABLE public.custom_field_values TO authenticated;
GRANT ALL ON TABLE public.custom_field_values TO service_role;
REVOKE ALL ON TABLE public.custom_field_values FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.custom_field_values FROM authenticated;

-- Migration 28: richer custom fields (Settings > Customize > Custom fields).
--
-- New types, each checked here whatever the client sends:
--   checkbox   true (unticked = no row)
--   labels     a list of 1..30 of the field's choices (multi-select tags)
--   people     the id of a member of the task's workspace
--   rating     a whole number 1..5
--   money      a finite number (amount; the currency is the field's name, e.g. "Budget (USD)")
--   email      an e-mail address up to 320 characters
--   phone      digits, spaces and + - ( ) . up to 40 characters
--   long_text  text of 1..10000 characters
-- New settings per field:
--   is_required    shown with a marker and flagged on tasks that miss it (a reminder, not a block)
--   default_value  filled in on every NEW task (a default that is not valid for the field is skipped)
--   folder_ids     show the field only on lists in these folders (NULL = everywhere)
--
-- Rollback: DROP TRIGGER trg_tasks_field_defaults ON public.tasks; DROP FUNCTION public.apply_field_defaults();
--   restore guard_custom_field_value() from migration 17; ALTER TABLE public.custom_fields DROP COLUMN is_required,
--   DROP COLUMN default_value, DROP COLUMN folder_ids; restore the two CHECK constraints from migration 17
--   (only after deleting fields of the new types).

ALTER TABLE public.custom_fields DROP CONSTRAINT IF EXISTS custom_fields_field_type_check;
ALTER TABLE public.custom_fields ADD CONSTRAINT custom_fields_field_type_check
  CHECK (field_type IN ('text', 'url', 'number', 'dropdown', 'date', 'checkbox', 'labels', 'people', 'rating', 'money', 'email', 'phone', 'long_text'));

ALTER TABLE public.custom_fields DROP CONSTRAINT IF EXISTS custom_fields_options_match_type;
ALTER TABLE public.custom_fields ADD CONSTRAINT custom_fields_options_match_type CHECK (
  (field_type IN ('dropdown', 'labels') AND options IS NOT NULL AND private.valid_field_options(options))
  OR (field_type NOT IN ('dropdown', 'labels') AND options IS NULL)
);

ALTER TABLE public.custom_fields ADD COLUMN IF NOT EXISTS is_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.custom_fields ADD COLUMN IF NOT EXISTS default_value JSONB;
ALTER TABLE public.custom_fields ADD COLUMN IF NOT EXISTS folder_ids UUID[];
GRANT UPDATE (is_required, default_value, folder_ids) ON TABLE public.custom_fields TO authenticated;

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
  ELSIF f.field_type = 'long_text' THEN
    IF jsonb_typeof(v) <> 'string' OR char_length(s) NOT BETWEEN 1 AND 10000 THEN
      RAISE EXCEPTION '% must be text of 1 to 10000 characters', f.name USING ERRCODE = '23514';
    END IF;
  ELSIF f.field_type = 'url' THEN
    IF jsonb_typeof(v) <> 'string' OR char_length(s) > 2048 OR s !~* '^https?://[^[:space:]/?#]+([/?#][^[:space:]]*)?$' THEN
      RAISE EXCEPTION '% must be an http(s) link of at most 2048 characters', f.name USING ERRCODE = '23514';
    END IF;
  ELSIF f.field_type IN ('number', 'money') THEN
    IF jsonb_typeof(v) <> 'number' THEN
      RAISE EXCEPTION '% must be a number', f.name USING ERRCODE = '23514';
    END IF;
  ELSIF f.field_type = 'rating' THEN
    IF jsonb_typeof(v) <> 'number' OR s !~ '^[1-5]$' THEN
      RAISE EXCEPTION '% must be a rating from 1 to 5', f.name USING ERRCODE = '23514';
    END IF;
  ELSIF f.field_type = 'checkbox' THEN
    IF v <> 'true'::jsonb THEN
      RAISE EXCEPTION '% is ticked with true (untick by deleting the value)', f.name USING ERRCODE = '23514';
    END IF;
  ELSIF f.field_type = 'dropdown' THEN
    IF jsonb_typeof(v) <> 'string' OR f.options IS NULL OR NOT (f.options @> v) THEN
      RAISE EXCEPTION '% must be one of its choices', f.name USING ERRCODE = '23514';
    END IF;
  ELSIF f.field_type = 'labels' THEN
    IF jsonb_typeof(v) <> 'array' OR jsonb_array_length(v) NOT BETWEEN 1 AND 30 OR f.options IS NULL OR NOT (f.options @> v)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE jsonb_typeof(e) <> 'string') THEN
      RAISE EXCEPTION '% must be a list of its choices', f.name USING ERRCODE = '23514';
    END IF;
  ELSIF f.field_type = 'people' THEN
    IF jsonb_typeof(v) <> 'string' OR s !~ '^[0-9a-fA-F-]{36}$'
       OR NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = ws AND m.user_id = s::uuid) THEN
      RAISE EXCEPTION '% must be a member of this workspace', f.name USING ERRCODE = '23514';
    END IF;
  ELSIF f.field_type = 'email' THEN
    IF jsonb_typeof(v) <> 'string' OR char_length(s) > 320 OR s !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION '% must be an e-mail address', f.name USING ERRCODE = '23514';
    END IF;
  ELSIF f.field_type = 'phone' THEN
    IF jsonb_typeof(v) <> 'string' OR s !~ '^[0-9+() .-]{3,40}$' THEN
      RAISE EXCEPTION '% must be a phone number', f.name USING ERRCODE = '23514';
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

-- defaults on new tasks: each one goes through the same guard; one that does not fit is skipped, never blocking
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
REVOKE ALL ON FUNCTION public.apply_field_defaults() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tasks_field_defaults ON public.tasks;
CREATE TRIGGER trg_tasks_field_defaults AFTER INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.apply_field_defaults();

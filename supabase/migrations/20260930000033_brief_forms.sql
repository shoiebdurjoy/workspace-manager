-- Migration 33: client brief forms (Settings > Customize workspace > Brief forms, public page /brief/<token>).
--
-- A manager makes a form for one client list and shares its link. The client fills it in WITHOUT an account and a
-- video task appears in that list (status: the workflow's starting status), with the brief, the client's contact
-- and the chosen custom fields filled in. Automations on "a video is created" then run as usual.
--
-- How the public page is kept safe (no SECURITY DEFINER function is exposed to the API):
--   * The link carries a random 64-character token (two random UUIDs). The page sends it as the HTTP header x-brief-token on every request.
--   * anon may SELECT exactly one brief_forms row: the enabled form whose token equals that header. It cannot list
--     forms, read other tables, or see other workspaces. The form keeps a snapshot of the fields it asks for, so the
--     page never reads custom_fields.
--   * anon may INSERT into brief_submissions only for that same form; it cannot read submissions back.
--   * A trigger turns the submission into the task (in the form's list) and checks the answers: lengths, the field
--     types (through the custom field guard), and at most 30 submissions per form per hour.
-- Managers (Owner / Admin / Production Manager) create, edit, disable and delete forms and read submissions.
--
-- Rollback: DROP TABLE public.brief_submissions; DROP TABLE public.brief_forms;
--   DROP FUNCTION public.guard_brief_form(), public.process_brief_submission();

CREATE TABLE public.brief_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  list_id UUID NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 100),
  intro TEXT CHECK (intro IS NULL OR char_length(intro) <= 2000),
  fields JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fields) = 'array' AND jsonb_array_length(fields) <= 20),
  enabled BOOLEAN NOT NULL DEFAULT true,
  submission_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_brief_forms_workspace ON public.brief_forms(workspace_id);

CREATE TABLE public.brief_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES public.brief_forms(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  brief TEXT CHECK (brief IS NULL OR char_length(brief) <= 5000),
  contact_name TEXT CHECK (contact_name IS NULL OR char_length(contact_name) <= 120),
  contact_email TEXT CHECK (contact_email IS NULL OR (char_length(contact_email) <= 320 AND contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  answers JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_brief_submissions_form ON public.brief_submissions(form_id, created_at);

-- forms: the list must be in the workspace; the field snapshot is taken from the workspace's own fields
CREATE OR REPLACE FUNCTION public.guard_brief_form()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  snap JSONB;
BEGIN
  NEW.title := btrim(NEW.title);
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := NOW();
    NEW.submission_count := 0;
    NEW.token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  ELSE
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'a form cannot move to another workspace' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.token := OLD.token;
    NEW.submission_count := CASE WHEN current_setting('tbb.brief', true) = 'on' THEN NEW.submission_count ELSE OLD.submission_count END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lists WHERE id = NEW.list_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'that list belongs to another workspace' USING ERRCODE = '23514';
  END IF;
  -- keep only fields of this workspace, as {id, name, type, options, required}
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'type', f.field_type, 'options', f.options, 'required', f.is_required) ORDER BY x.ord), '[]'::jsonb)
  INTO snap
  FROM jsonb_array_elements(NEW.fields) WITH ORDINALITY AS x(el, ord)
  JOIN public.custom_fields f ON f.id::text = COALESCE(x.el->>'id', x.el #>> '{}') AND f.workspace_id = NEW.workspace_id
  WHERE f.field_type <> 'people';
  NEW.fields := snap;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_brief_form() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_brief_forms_guard BEFORE INSERT OR UPDATE ON public.brief_forms FOR EACH ROW EXECUTE FUNCTION public.guard_brief_form();

-- a submission becomes a task in the form's list
CREATE OR REPLACE FUNCTION public.process_brief_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  f RECORD;
  t UUID;
  fld JSONB;
  ans JSONB;
  body TEXT;
BEGIN
  SELECT * INTO f FROM public.brief_forms WHERE id = NEW.form_id;
  IF f.id IS NULL OR NOT f.enabled THEN
    RAISE EXCEPTION 'this form is closed' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.brief_submissions WHERE form_id = f.id AND created_at > NOW() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'too many briefs in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;
  NEW.workspace_id := f.workspace_id;
  NEW.created_at := NOW();
  NEW.title := btrim(NEW.title);
  -- required fields of the form must be answered
  FOR fld IN SELECT * FROM jsonb_array_elements(f.fields) LOOP
    IF (fld->>'required')::boolean AND (NEW.answers->(fld->>'id') IS NULL OR NEW.answers->>(fld->>'id') = '') THEN
      RAISE EXCEPTION '% is required', fld->>'name' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  body := COALESCE(NEW.brief, '');
  IF NEW.contact_name IS NOT NULL OR NEW.contact_email IS NOT NULL THEN
    body := body || E'\n\n--\nFrom the client brief form "' || f.title || '": ' || COALESCE(NEW.contact_name, '') ||
            CASE WHEN NEW.contact_email IS NOT NULL THEN ' <' || NEW.contact_email || '>' ELSE '' END;
  END IF;
  INSERT INTO public.tasks (list_id, title, description) VALUES (f.list_id, left(NEW.title, 200), nullif(btrim(body), ''))
  RETURNING id INTO t;
  NEW.task_id := t;

  -- answers go through the custom field guard; one that does not fit is refused with its message
  FOR fld IN SELECT * FROM jsonb_array_elements(f.fields) LOOP
    ans := NEW.answers->(fld->>'id');
    IF ans IS NOT NULL AND jsonb_typeof(ans) <> 'null' AND ans <> '""'::jsonb THEN
      INSERT INTO public.custom_field_values (task_id, field_id, workspace_id, value) VALUES (t, (fld->>'id')::uuid, f.workspace_id, ans)
      ON CONFLICT (task_id, field_id) DO UPDATE SET value = EXCLUDED.value;
    END IF;
  END LOOP;

  PERFORM set_config('tbb.brief', 'on', true);
  UPDATE public.brief_forms SET submission_count = submission_count + 1 WHERE id = f.id;
  PERFORM set_config('tbb.brief', 'off', true);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.process_brief_submission() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_brief_submissions_process BEFORE INSERT ON public.brief_submissions FOR EACH ROW EXECUTE FUNCTION public.process_brief_submission();

ALTER TABLE public.brief_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brief_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brief_forms_manager_select" ON public.brief_forms FOR SELECT TO authenticated USING (private.is_workspace_manager(workspace_id));
CREATE POLICY "brief_forms_public_select" ON public.brief_forms FOR SELECT TO anon USING (enabled AND token = nullif(current_setting('request.headers', true)::json->>'x-brief-token', ''));
CREATE POLICY "brief_forms_insert" ON public.brief_forms FOR INSERT TO authenticated WITH CHECK (private.is_workspace_manager(workspace_id));
CREATE POLICY "brief_forms_update" ON public.brief_forms FOR UPDATE TO authenticated
  USING (private.is_workspace_manager(workspace_id)) WITH CHECK (private.is_workspace_manager(workspace_id));
CREATE POLICY "brief_forms_delete" ON public.brief_forms FOR DELETE TO authenticated USING (private.is_workspace_manager(workspace_id));

CREATE POLICY "brief_submissions_manager_select" ON public.brief_submissions FOR SELECT TO authenticated USING (private.is_workspace_manager(workspace_id));
CREATE POLICY "brief_submissions_public_insert" ON public.brief_submissions FOR INSERT TO anon
  WITH CHECK (EXISTS (SELECT 1 FROM public.brief_forms bf WHERE bf.id = form_id AND bf.enabled AND bf.token = nullif(current_setting('request.headers', true)::json->>'x-brief-token', '')));

-- anon: only these columns, only these two statements
-- token and enabled are readable only on the one row whose token the caller already sent (RLS); the insert check needs them
GRANT SELECT (id, title, intro, fields, enabled, token) ON TABLE public.brief_forms TO anon;
GRANT INSERT (form_id, title, brief, contact_name, contact_email, answers) ON TABLE public.brief_submissions TO anon;
GRANT SELECT, DELETE ON TABLE public.brief_forms TO authenticated;
GRANT INSERT (workspace_id, list_id, title, intro, fields, enabled) ON TABLE public.brief_forms TO authenticated;
GRANT UPDATE (list_id, title, intro, fields, enabled) ON TABLE public.brief_forms TO authenticated;
GRANT SELECT ON TABLE public.brief_submissions TO authenticated;
GRANT ALL ON TABLE public.brief_forms, public.brief_submissions TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.brief_forms, public.brief_submissions FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.brief_forms, public.brief_submissions FROM authenticated;

-- ==============================================================================
-- Migration: 20260930000008_workflow_engine.sql
-- Phase 7 — TBB workflow & status engine
--
-- Replaces the generic task status CHECK list (migration 1) with a data-driven workflow that the
-- DATABASE enforces as a state machine. docs/TBB_REQUIREMENTS.md 3 requires statuses to live in a
-- workflow entity, never in a CHECK constraint or an enum; docs/TBB_PHASE_7_WORKFLOW.md explains
-- every decision below.
--
--  1. workflows / workflow_statuses / workflow_transitions: configuration, one default workflow per
--     workspace (per-list workflows are a later extension: the tables already carry workflow_id).
--     Signed-in staff can READ them; nobody can write them through the API (changing a workflow is
--     an administrative migration until a workflow editor exists).
--  2. The TBB workflow is created for every workspace (existing ones here, new ones by trigger).
--     This is configuration the app needs, not sample data.
--  3. tasks.status keeps its text column (stable keys like QC_FIRST_APPROVAL), loses its CHECK, and
--     is validated by trigger against the task's workflow. Existing rows are mapped to the new keys.
--  4. tasks.revision_count: system-managed. +1 every time a task enters QC - REVISION NEEDED; no
--     client (not even a manager) can set it.
--  5. enforce_task_workflow (BEFORE trigger): every status change must be an edge of the workflow
--     allowed for the caller's role (an EDITOR additionally only on tasks assigned to them, already
--     enforced by guard_task_update); OWNER / ADMIN may override any edge (the permission model's
--     "overrides QC decisions"). Entering a status checks its requirements (editor assigned, review
--     link, final export link, revision note). New tasks start at the workflow's initial status.
--  6. task_status_events: append-only history of every status change (who, from, to, when, note,
--     override). Written only by trigger; staff can read it. Phase 10's activity feed consumes it.
--  7. transition_task(): the one call the app uses to change status (atomic, SECURITY INVOKER, with
--     an optional note and links, and a stale-state check).
--  8. guard_task_update: the status rules move to the workflow trigger; QC may now also set the
--     final export link (needed to deliver to the client).
--
-- Rollback: restore the CHECK constraint and guard_task_update from migration 7, drop the new
-- triggers, functions, tables and tasks.revision_count, and map statuses back.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Workflow configuration
-- ------------------------------------------------------------------------------

CREATE TABLE public.workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX workflows_one_default_per_workspace ON public.workflows(workspace_id) WHERE is_default;

CREATE TABLE public.workflow_statuses (
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  key VARCHAR(50) NOT NULL CHECK (key ~ '^[A-Z][A-Z0-9_]{1,49}$'),
  name VARCHAR(60) NOT NULL,
  category VARCHAR(20) NOT NULL CHECK (category IN ('NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'READY', 'CLIENT', 'COMPLETED')),
  color VARCHAR(7) NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  position INT NOT NULL,
  description TEXT,
  is_initial BOOLEAN NOT NULL DEFAULT false,
  requires_editor BOOLEAN NOT NULL DEFAULT false,
  requires_review_link BOOLEAN NOT NULL DEFAULT false,
  requires_final_export BOOLEAN NOT NULL DEFAULT false,
  requires_note BOOLEAN NOT NULL DEFAULT false,
  counts_revision BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (workflow_id, key)
);
CREATE UNIQUE INDEX workflow_statuses_one_initial ON public.workflow_statuses(workflow_id) WHERE is_initial;

CREATE TABLE public.workflow_transitions (
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  from_key VARCHAR(50) NOT NULL,
  to_key VARCHAR(50) NOT NULL,
  label VARCHAR(60) NOT NULL,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('forward', 'back', 'reject')),
  roles TEXT[] NOT NULL CHECK (roles <@ ARRAY['OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST', 'EDITOR']::TEXT[]),
  PRIMARY KEY (workflow_id, from_key, to_key),
  CHECK (from_key <> to_key),
  FOREIGN KEY (workflow_id, from_key) REFERENCES public.workflow_statuses(workflow_id, key) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id, to_key) REFERENCES public.workflow_statuses(workflow_id, key) ON DELETE CASCADE
);

ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflows_select" ON public.workflows FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id));
CREATE POLICY "workflow_statuses_select" ON public.workflow_statuses FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND private.is_internal_member(w.workspace_id)));
CREATE POLICY "workflow_transitions_select" ON public.workflow_transitions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = workflow_id AND private.is_internal_member(w.workspace_id)));

-- read-only for the app; no INSERT / UPDATE / DELETE policy and no write grant
GRANT SELECT ON TABLE public.workflows, public.workflow_statuses, public.workflow_transitions TO authenticated;
GRANT ALL ON TABLE public.workflows, public.workflow_statuses, public.workflow_transitions TO service_role;
REVOKE ALL ON TABLE public.workflows, public.workflow_statuses, public.workflow_transitions FROM anon;
-- in case the project auto-grants new tables to API roles: authenticated may only read
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.workflows, public.workflow_statuses, public.workflow_transitions FROM authenticated;

-- ------------------------------------------------------------------------------
-- 2. The TBB workflow (configuration), for every workspace
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.create_tbb_workflow(ws UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  wf UUID;
  m TEXT[] := ARRAY['OWNER', 'ADMIN', 'PRODUCTION_MANAGER'];
  q TEXT[] := ARRAY['OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST'];
  e TEXT[] := ARRAY['OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'EDITOR'];
BEGIN
  SELECT id INTO wf FROM public.workflows WHERE workspace_id = ws AND is_default;
  IF wf IS NOT NULL THEN
    RETURN wf;
  END IF;

  INSERT INTO public.workflows (workspace_id, name, is_default) VALUES (ws, 'TBB video production', true)
  RETURNING id INTO wf;

  INSERT INTO public.workflow_statuses
    (workflow_id, key, name, category, color, position, description, is_initial, requires_editor, requires_review_link, requires_final_export, requires_note, counts_revision)
  VALUES
    (wf, 'TO_BE_EDITED',       'TO BE EDITED',          'NOT_STARTED', '#94A3B8', 0, 'Brief and footage received; not yet in the edit pipeline.', true,  false, false, false, false, false),
    (wf, 'IN_EDIT',            'IN EDIT',               'IN_PROGRESS', '#FB923C', 1, 'Accepted into the edit pipeline; waiting for an editor.',     false, false, false, false, false, false),
    (wf, 'ASSIGNED',           'ASSIGNED',              'IN_PROGRESS', '#F97316', 2, 'In an editor''s queue.',                                       false, true,  false, false, false, false),
    (wf, 'STARTED_EDITING',    'STARTED EDITING',       'IN_PROGRESS', '#EA580C', 3, 'The editor is working on the cut.',                            false, true,  false, false, false, false),
    (wf, 'QC_FIRST_APPROVAL',  'QC - FIRST APPROVAL',   'IN_REVIEW',   '#EAB308', 4, 'First cut submitted; waiting for QC.',                         false, true,  true,  false, false, false),
    (wf, 'QC_REVISION_NEEDED', 'QC - REVISION NEEDED',  'IN_REVIEW',   '#DC2626', 5, 'QC (or the client) asked for changes; back with the editor.',  false, true,  false, false, true,  true),
    (wf, 'QC_FINAL_APPROVAL',  'QC - FINAL APPROVAL',   'IN_REVIEW',   '#CA8A04', 6, 'Revised or passed cut waiting for final QC.',                  false, true,  true,  false, false, false),
    (wf, 'QC_APPROVED_RTD',    'QC - APPROVED (RTD)',   'READY',       '#16A34A', 7, 'Passed QC; ready to deliver.',                                 false, false, false, false, false, false),
    (wf, 'SENT_TO_CLIENT',     'SENT TO CLIENT',        'CLIENT',      '#0EA5E9', 8, 'Final export delivered to the client.',                        false, false, false, true,  false, false),
    (wf, 'CLOSED',             'CLOSED',                'COMPLETED',   '#15803D', 9, 'Done.',                                                        false, false, false, false, false, false);

  INSERT INTO public.workflow_transitions (workflow_id, from_key, to_key, label, kind, roles) VALUES
    (wf, 'TO_BE_EDITED',       'IN_EDIT',            'Move to edit queue',         'forward', m),
    (wf, 'TO_BE_EDITED',       'ASSIGNED',           'Assign to editor',           'forward', m),
    (wf, 'IN_EDIT',            'ASSIGNED',           'Assign to editor',           'forward', m),
    (wf, 'IN_EDIT',            'TO_BE_EDITED',       'Back to To be edited',       'back',    m),
    (wf, 'ASSIGNED',           'STARTED_EDITING',    'Start editing',              'forward', e),
    (wf, 'ASSIGNED',           'IN_EDIT',            'Back to edit queue',         'back',    m),
    (wf, 'STARTED_EDITING',    'QC_FIRST_APPROVAL',  'Submit for QC',              'forward', e),
    (wf, 'STARTED_EDITING',    'ASSIGNED',           'Pause editing',              'back',    e),
    (wf, 'QC_FIRST_APPROVAL',  'QC_APPROVED_RTD',    'Approve (ready to deliver)', 'forward', q),
    (wf, 'QC_FIRST_APPROVAL',  'QC_FINAL_APPROVAL',  'Pass to final approval',     'forward', q),
    (wf, 'QC_FIRST_APPROVAL',  'QC_REVISION_NEEDED', 'Request revision',           'reject',  q),
    (wf, 'QC_FIRST_APPROVAL',  'STARTED_EDITING',    'Withdraw from QC',           'back',    e),
    (wf, 'QC_REVISION_NEEDED', 'QC_FINAL_APPROVAL',  'Submit revision',            'forward', e),
    (wf, 'QC_FINAL_APPROVAL',  'QC_APPROVED_RTD',    'Approve (ready to deliver)', 'forward', q),
    (wf, 'QC_FINAL_APPROVAL',  'QC_REVISION_NEEDED', 'Request another revision',   'reject',  q),
    (wf, 'QC_APPROVED_RTD',    'SENT_TO_CLIENT',     'Send to client',             'forward', q),
    (wf, 'QC_APPROVED_RTD',    'QC_FINAL_APPROVAL',  'Reopen QC',                  'back',    q),
    (wf, 'SENT_TO_CLIENT',     'CLOSED',             'Close',                      'forward', m),
    (wf, 'SENT_TO_CLIENT',     'QC_REVISION_NEEDED', 'Client requested changes',   'reject',  q),
    (wf, 'CLOSED',             'SENT_TO_CLIENT',     'Reopen',                     'back',    m);

  RETURN wf;
END;
$$;
REVOKE ALL ON FUNCTION private.create_tbb_workflow(UUID) FROM PUBLIC, anon, authenticated;

SELECT private.create_tbb_workflow(id) FROM public.workspaces;

CREATE OR REPLACE FUNCTION public.handle_new_workspace_workflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.create_tbb_workflow(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_workspace_workflow() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_workspaces_default_workflow ON public.workspaces;
CREATE TRIGGER trg_workspaces_default_workflow AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_workspace_workflow();

-- ------------------------------------------------------------------------------
-- 3. tasks: workflow-validated status, system-managed revision counter
-- ------------------------------------------------------------------------------

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE public.tasks ADD COLUMN revision_count INT NOT NULL DEFAULT 0 CHECK (revision_count >= 0);

-- the generic statuses map onto the TBB workflow (the closest meaning; documented in Phase 7)
UPDATE public.tasks SET status = CASE status
  WHEN 'TODO' THEN 'TO_BE_EDITED'
  WHEN 'IN_PROGRESS' THEN 'STARTED_EDITING'
  WHEN 'IN_QC' THEN 'QC_FIRST_APPROVAL'
  WHEN 'READY_TO_DELIVER' THEN 'QC_APPROVED_RTD'
  WHEN 'CLIENT_REVIEW' THEN 'SENT_TO_CLIENT'
  WHEN 'COMPLETED' THEN 'CLOSED'
  ELSE status END;
ALTER TABLE public.tasks ALTER COLUMN status SET DEFAULT 'TO_BE_EDITED';

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status_pos ON public.tasks(workspace_id, status);

-- ------------------------------------------------------------------------------
-- 4. Status history (append-only)
-- ------------------------------------------------------------------------------

CREATE TABLE public.task_status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  from_status VARCHAR(50),
  to_status VARCHAR(50) NOT NULL,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  note TEXT CHECK (note IS NULL OR char_length(note) <= 2000),
  is_override BOOLEAN NOT NULL DEFAULT false,
  revision_number INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_task_status_events_task ON public.task_status_events(task_id, created_at DESC);
CREATE INDEX idx_task_status_events_workspace ON public.task_status_events(workspace_id, created_at DESC);

ALTER TABLE public.task_status_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_status_events_select" ON public.task_status_events FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id));
-- history is written by trigger only: no INSERT / UPDATE / DELETE policy and no write grant
GRANT SELECT ON TABLE public.task_status_events TO authenticated;
GRANT ALL ON TABLE public.task_status_events TO service_role;
REVOKE ALL ON TABLE public.task_status_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.task_status_events FROM authenticated;

-- ------------------------------------------------------------------------------
-- 5. The state machine
-- ------------------------------------------------------------------------------

-- The default workflow of a workspace (per-list workflows later: look at lists.workflow_id first).
CREATE OR REPLACE FUNCTION private.task_workflow_id(ws UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id FROM public.workflows WHERE workspace_id = ws AND is_default
$$;
REVOKE ALL ON FUNCTION private.task_workflow_id(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.task_workflow_id(UUID) TO authenticated, service_role;

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
  IF TG_OP = 'INSERT' THEN
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

REVOKE ALL ON FUNCTION public.enforce_task_workflow(), public.log_task_status_event() FROM PUBLIC, anon, authenticated;

-- Same-event triggers fire alphabetically: guard_update, set_workspace, updated_at, then workflow.
DROP TRIGGER IF EXISTS trg_tasks_workflow ON public.tasks;
CREATE TRIGGER trg_tasks_workflow BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_task_workflow();
DROP TRIGGER IF EXISTS trg_tasks_workflow_log ON public.tasks;
CREATE TRIGGER trg_tasks_workflow_log AFTER INSERT OR UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_task_status_event();

-- every existing task gets its starting point in the history (actor unknown: it predates history)
INSERT INTO public.task_status_events (task_id, workspace_id, from_status, to_status, actor_id, created_at)
SELECT id, workspace_id, NULL, status, NULL, created_at FROM public.tasks;

-- ------------------------------------------------------------------------------
-- 6. Column rules: status rules now live in the workflow trigger
-- ------------------------------------------------------------------------------

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

-- ------------------------------------------------------------------------------
-- 7. transition_task(): change status (optionally with a note / links) in one call
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.transition_task(
  p_task_id UUID,
  p_to TEXT,
  p_note TEXT DEFAULT NULL,
  p_review_link TEXT DEFAULT NULL,
  p_final_export_link TEXT DEFAULT NULL,
  p_expected_from TEXT DEFAULT NULL
)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  current_status TEXT;
  changed public.tasks;
BEGIN
  IF p_note IS NOT NULL AND char_length(p_note) > 2000 THEN
    RAISE EXCEPTION 'the note must be 2000 characters or fewer' USING ERRCODE = '22023';
  END IF;

  SELECT t.status INTO current_status FROM public.tasks t WHERE t.id = p_task_id FOR UPDATE;
  IF current_status IS NULL THEN
    RAISE EXCEPTION 'task not found' USING ERRCODE = 'P0002';
  END IF;
  -- someone else moved it since the person looked: do not apply a decision made on stale information
  IF p_expected_from IS NOT NULL AND current_status <> p_expected_from THEN
    RAISE EXCEPTION 'this task was moved by someone else in the meantime' USING ERRCODE = '40001';
  END IF;

  PERFORM set_config('tbb.transition_note', COALESCE(p_note, ''), true);

  UPDATE public.tasks t SET
    status = p_to,
    review_link = COALESCE(NULLIF(btrim(p_review_link), ''), t.review_link),
    final_export_link = COALESCE(NULLIF(btrim(p_final_export_link), ''), t.final_export_link)
  WHERE t.id = p_task_id
  RETURNING * INTO changed;

  IF changed.id IS NULL THEN
    RAISE EXCEPTION 'you do not have permission to change this task' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('tbb.transition_note', '', true);
  RETURN changed;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_task(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_task(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

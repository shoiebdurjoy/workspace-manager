-- Migration 23: the three ClickUp statuses TBB was missing.
--
--   CLIENT REVISION NEEDED  the client asked for changes (counts as a revision, needs a note)
--   CLIENT APPROVED         the client signed the video off
--   PAUSED                  parked before the cut is finished (client on hold, waiting for footage)
--
-- Also respells the four QC stages the way ClickUp writes them ("QC- FIRST APPROVAL").
-- Configuration only (workflow_statuses / workflow_transitions): no table, policy or function signature changes.
-- Existing workspaces get the rows now; new workspaces get them through create_tbb_workflow (wrapped below).
-- Rollback: delete the three statuses and their transitions, move CLOSED back to position 9 (only safe while no
-- task uses them).

CREATE OR REPLACE FUNCTION private.add_client_statuses(wf UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  m TEXT[] := ARRAY['OWNER', 'ADMIN', 'PRODUCTION_MANAGER'];
  q TEXT[] := ARRAY['OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST'];
BEGIN
  IF EXISTS (SELECT 1 FROM public.workflow_statuses WHERE workflow_id = wf AND key = 'PAUSED') THEN
    RETURN;
  END IF;

  -- ClickUp's exact spelling for the QC stages ("QC- FIRST APPROVAL")
  UPDATE public.workflow_statuses SET name = replace(name, 'QC - ', 'QC- ') WHERE workflow_id = wf AND name LIKE 'QC - %';

  UPDATE public.workflow_statuses SET position = 12 WHERE workflow_id = wf AND key = 'CLOSED';

  INSERT INTO public.workflow_statuses
    (workflow_id, key, name, category, color, position, description, is_initial, requires_editor, requires_review_link, requires_final_export, requires_note, counts_revision)
  VALUES
    (wf, 'CLIENT_REVISION_NEEDED', 'CLIENT REVISION NEEDED', 'CLIENT',      '#EF4444', 9,  'The client asked for changes; send it back to the editor.', false, false, false, false, true,  true),
    (wf, 'CLIENT_APPROVED',        'CLIENT APPROVED',        'CLIENT',      '#22C55E', 10, 'The client approved the video.',                            false, false, false, false, false, false),
    (wf, 'PAUSED',                 'PAUSED',                 'NOT_STARTED', '#64748B', 11, 'On hold; not being worked on right now.',                   false, false, false, false, false, false);

  INSERT INTO public.workflow_transitions (workflow_id, from_key, to_key, label, kind, roles) VALUES
    (wf, 'SENT_TO_CLIENT',          'CLIENT_REVISION_NEEDED', 'Client requested changes',  'reject',  q),
    (wf, 'SENT_TO_CLIENT',          'CLIENT_APPROVED',        'Client approved',           'forward', m),
    (wf, 'CLIENT_REVISION_NEEDED',  'QC_REVISION_NEEDED',     'Send back to the editor',   'forward', q),
    (wf, 'CLIENT_REVISION_NEEDED',  'SENT_TO_CLIENT',         'Back to Sent to client',    'back',    m),
    (wf, 'CLIENT_APPROVED',         'CLOSED',                 'Close',                     'forward', m),
    (wf, 'CLIENT_APPROVED',         'SENT_TO_CLIENT',         'Back to Sent to client',    'back',    m),
    (wf, 'CLOSED',                  'CLIENT_APPROVED',        'Reopen as client approved', 'back',    m),
    (wf, 'TO_BE_EDITED',            'PAUSED',                 'Pause',                     'forward', m),
    (wf, 'IN_EDIT',                 'PAUSED',                 'Pause',                     'forward', m),
    (wf, 'ASSIGNED',                'PAUSED',                 'Pause',                     'forward', m),
    (wf, 'STARTED_EDITING',         'PAUSED',                 'Pause',                     'forward', m),
    (wf, 'PAUSED',                  'TO_BE_EDITED',           'Resume (to be edited)',     'back',    m),
    (wf, 'PAUSED',                  'IN_EDIT',                'Resume (edit queue)',       'back',    m),
    (wf, 'PAUSED',                  'ASSIGNED',               'Resume (assigned)',         'back',    m)
  ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION private.add_client_statuses(UUID) FROM PUBLIC, anon, authenticated;

SELECT private.add_client_statuses(id) FROM public.workflows WHERE is_default;

CREATE OR REPLACE FUNCTION public.handle_new_workspace_workflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  wf UUID;
BEGIN
  wf := private.create_tbb_workflow(NEW.id);
  UPDATE public.workflow_statuses SET credits_production = true WHERE workflow_id = wf AND key = 'QC_FIRST_APPROVAL';
  PERFORM private.add_client_statuses(wf);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_workspace_workflow() FROM PUBLIC, anon, authenticated;

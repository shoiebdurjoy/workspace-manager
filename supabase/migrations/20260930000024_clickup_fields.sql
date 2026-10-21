-- Migration 24: the custom fields TBB's ClickUp tasks carry, created in every workspace.
--
-- The same ten fields, in ClickUp's order, so a task here looks like the one in ClickUp: the six video links
-- (A to F), the two dates, HOOK VARIATION and Video Format Needed. Owner / Admin / Production Manager can still
-- add, rename, re-order or delete them (custom_fields RLS is unchanged). Re-running adds nothing twice.
--
-- Rollback: DELETE FROM public.custom_fields WHERE name IN (...the ten names below...);  (this also deletes their values)

INSERT INTO public.custom_fields (workspace_id, name, field_type, position)
SELECT w.id, f.name, f.field_type, f.position
FROM public.workspaces w
CROSS JOIN (VALUES
  ('HOOK VARIATION',               'number', 0),
  ('D) Example Video',             'url',    1),
  ('A) Link to the Raw Video',     'url',    2),
  ('Assigned date',                'date',   3),
  ('B) Brand Guidelines',          'url',    4),
  ('C) B-Roll/Assets',             'url',    5),
  ('E) LINK TO THE EDITED VIDEO',  'url',    6),
  ('F) Loom video',                'url',    7),
  ('First Approval Date',          'date',   8),
  ('Video Format Needed',          'text',   9)
) AS f(name, field_type, position)
ON CONFLICT DO NOTHING;

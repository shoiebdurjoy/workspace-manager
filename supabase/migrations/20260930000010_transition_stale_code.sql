-- ==============================================================================
-- Migration 10: transition_task reports a stale move with its own SQLSTATE
-- ==============================================================================
-- Migration 8 raised SQLSTATE 40001 (serialization_failure) when someone else moved the task
-- first. On the hosted API that code never comes back as an error: the request hangs until the
-- gateway answers "upstream request timeout" (found by the live suite). The app could therefore
-- never tell a person "someone else moved this task".
--
-- The move is now refused with the custom SQLSTATE 'TB409' (class TB, "TBB conflict"), which the
-- API returns as an ordinary 400 with that code. Nothing else about the function changes.
--
-- Rollback: re-apply the transition_task() definition of migration 8.
-- ==============================================================================

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
    RAISE EXCEPTION 'this task was moved by someone else in the meantime' USING ERRCODE = 'TB409';
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

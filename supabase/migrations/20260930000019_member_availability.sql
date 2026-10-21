-- ==============================================================================
-- Migration 19: team availability (who is free, working, at capacity or on leave)
-- ==============================================================================
-- Replaces "message them on WhatsApp to ask": each staff member sets their own availability in the app;
-- managers see everyone's on the Team page and in the editor picker.
--
--   member_availability(workspace_id, user_id, status, note, back_on, updated_at)
--     status: AVAILABLE | WORKING (on a project, can take more) | BUSY (at capacity) | ON_LEAVE
--     note:   optional, at most 80 characters ("Finishing the Medicus batch")
--     back_on: optional return date, only for ON_LEAVE
--
--   * Read: internal staff of the workspace (client viewers see nothing).
--   * Write: a person writes ONLY their own row, and only while an internal member of that workspace.
--     Not even an Owner sets someone else's status (it is the person's own signal).
--   * The guard forces updated_at to the server's time and keeps the row's owner and workspace fixed.
--   * No row = never set (the app shows "No status").
--
-- Rollback: DROP TABLE public.member_availability; DROP FUNCTION public.guard_member_availability();
-- ==============================================================================

CREATE TABLE public.member_availability (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('AVAILABLE', 'WORKING', 'BUSY', 'ON_LEAVE')),
  note TEXT CHECK (note IS NULL OR (char_length(note) BETWEEN 1 AND 80 AND note !~ '[[:cntrl:]]')),
  back_on DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT member_availability_back_on_only_on_leave CHECK (back_on IS NULL OR status = 'ON_LEAVE')
);
CREATE INDEX idx_member_availability_user ON public.member_availability(user_id);

CREATE OR REPLACE FUNCTION public.guard_member_availability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'an availability row cannot change hands' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := NOW();
  NEW.note := NULLIF(btrim(COALESCE(NEW.note, '')), '');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_member_availability() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_member_availability_guard BEFORE INSERT OR UPDATE ON public.member_availability
  FOR EACH ROW EXECUTE FUNCTION public.guard_member_availability();

ALTER TABLE public.member_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "member_availability_select" ON public.member_availability FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id));
CREATE POLICY "member_availability_insert" ON public.member_availability FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND private.is_internal_member(workspace_id));
CREATE POLICY "member_availability_update" ON public.member_availability FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND private.is_internal_member(workspace_id))
  WITH CHECK (user_id = (SELECT auth.uid()) AND private.is_internal_member(workspace_id));
CREATE POLICY "member_availability_delete" ON public.member_availability FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, DELETE ON TABLE public.member_availability TO authenticated;
GRANT UPDATE (status, note, back_on) ON TABLE public.member_availability TO authenticated;
GRANT ALL ON TABLE public.member_availability TO service_role;
REVOKE ALL ON TABLE public.member_availability FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.member_availability FROM authenticated;

-- live updates for the Team page and the avatars (Realtime applies the table's RLS); skipped on plain Postgres
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.member_availability;
  END IF;
END $$;

-- ==============================================================================
-- Migration 12: task comments with real @mentions (Phase 10)
-- ==============================================================================
-- A comment belongs to a task. Everything that matters is decided here, not in the interface:
--
--   * who may read / write: workspace staff (Owner, Admin, Production Manager, QC, Editor). Client
--     viewers have no task access yet, so they have no comments either (fail closed).
--   * the author is always the signed-in person (a forged author_id is overwritten), and only the author
--     can edit a comment; only the author or an Owner / Admin can delete one. Nobody else can change it.
--   * a mention is written in the text as @[Name](user-id). The database reads those tokens itself and
--     keeps the people it can verify (an active staff member of THIS workspace) in `mentions`; a token for
--     anyone else (a client, a stranger, a made-up id, a deactivated account) is just text. The client
--     can never claim to have mentioned someone, and a mention can never reach outside the workspace.
--
-- Rollback (loses every comment):
--   DROP TABLE public.task_comments;
--   DROP FUNCTION public.guard_task_comment(), private.comment_mentions(UUID, TEXT);
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Reading the mentions out of a comment's text
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.comment_mentions(ws UUID, body TEXT)
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(ARRAY(
    SELECT DISTINCT u.id
    FROM (
      SELECT t.groups[1]::uuid AS id
      FROM regexp_matches(
        body,
        '@\[[^\]\n]{1,100}\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)',
        'g'
      ) AS t(groups)
      LIMIT 50
    ) u
    JOIN public.workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = ws
    JOIN public.profiles p ON p.id = u.id AND p.is_active
    WHERE wm.role IN ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST', 'EDITOR')
    LIMIT 20
  ), ARRAY[]::UUID[])
$$;
REVOKE ALL ON FUNCTION private.comment_mentions(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.comment_mentions(UUID, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. The table
-- ------------------------------------------------------------------------------

CREATE TABLE public.task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- who wrote it; kept (as a former member) when the account is removed
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
  -- derived from the text by guard_task_comment: the verified people it mentions
  mentions UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- set when the text is changed after posting
  edited_at TIMESTAMPTZ
);

CREATE INDEX idx_task_comments_task ON public.task_comments(task_id, created_at, id);
CREATE INDEX idx_task_comments_workspace ON public.task_comments(workspace_id);
CREATE INDEX idx_task_comments_author ON public.task_comments(author_id);

-- ------------------------------------------------------------------------------
-- 3. Guard: derived fields are never taken from the client
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_task_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ws UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT t.workspace_id INTO ws FROM public.tasks t WHERE t.id = NEW.task_id;
    IF ws IS NULL THEN
      RAISE EXCEPTION 'task % does not exist', NEW.task_id USING ERRCODE = '23503';
    END IF;
    NEW.workspace_id := ws;
    IF auth.uid() IS NOT NULL THEN
      NEW.author_id := auth.uid();
    END IF;
    NEW.created_at := NOW();
    NEW.updated_at := NEW.created_at;
    NEW.edited_at := NULL;
  ELSE
    -- The one change that is not an edit: the author's account was deleted and the foreign key
    -- (ON DELETE SET NULL) blanks the author. The profile is already gone when that runs; nobody
    -- can produce the same state by hand, so a comment can never be re-attributed.
    IF NEW.author_id IS DISTINCT FROM OLD.author_id
       AND (NEW.author_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.author_id)) THEN
      RAISE EXCEPTION 'only the text of a comment can be changed' USING ERRCODE = '42501';
    END IF;
    IF NEW.task_id IS DISTINCT FROM OLD.task_id
       OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'only the text of a comment can be changed' USING ERRCODE = '42501';
    END IF;
    IF NEW.body IS DISTINCT FROM OLD.body THEN
      NEW.edited_at := NOW();
      NEW.updated_at := NEW.edited_at;
    ELSE
      NEW.edited_at := OLD.edited_at;
      NEW.updated_at := OLD.updated_at;
    END IF;
    ws := OLD.workspace_id;
  END IF;
  NEW.mentions := private.comment_mentions(ws, NEW.body);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_task_comment() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_task_comments_guard BEFORE INSERT OR UPDATE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.guard_task_comment();

-- ------------------------------------------------------------------------------
-- 4. RLS and grants
-- ------------------------------------------------------------------------------

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_comments_select" ON public.task_comments FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id));

CREATE POLICY "task_comments_insert" ON public.task_comments FOR INSERT TO authenticated
  WITH CHECK (private.is_internal_member(workspace_id) AND author_id = (SELECT auth.uid()));

CREATE POLICY "task_comments_update_own" ON public.task_comments FOR UPDATE TO authenticated
  USING (private.is_internal_member(workspace_id) AND author_id = (SELECT auth.uid()))
  WITH CHECK (private.is_internal_member(workspace_id) AND author_id = (SELECT auth.uid()));

CREATE POLICY "task_comments_delete_own_or_admin" ON public.task_comments FOR DELETE TO authenticated
  USING (private.is_internal_member(workspace_id) AND (author_id = (SELECT auth.uid()) OR private.is_workspace_admin(workspace_id)));

GRANT SELECT, INSERT, DELETE ON TABLE public.task_comments TO authenticated;
-- the only column anyone may change afterwards is the text
GRANT UPDATE (body) ON TABLE public.task_comments TO authenticated;
GRANT ALL ON TABLE public.task_comments TO service_role;
REVOKE ALL ON TABLE public.task_comments FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.task_comments FROM authenticated;

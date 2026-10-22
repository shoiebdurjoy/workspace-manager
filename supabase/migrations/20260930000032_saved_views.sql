-- Migration 32: saved views, like ClickUp's (the "Views" menu in every list, Everything and My Tasks).
--
-- A saved view remembers how a set of tasks is looked at: its filters, search, grouping and sort (the query string
-- the app keeps in the URL) and the layout (list / board / table). It belongs to one place (`scope`: a list id,
-- 'everything' or 'mine') and is either PRIVATE (only its owner sees it) or SHARED with the whole team. One view
-- per place can be the default, opened when someone arrives without filters: a person's own default wins over the
-- shared one.
--   Anyone on the staff saves private views. Owner / Admin / Production Manager share views and set the shared
--   default. Only the owner of a private view (or a manager, for shared views) changes or deletes it.
--   At most 30 views per person per place; names 1..60 characters; the query is at most 2000 characters.
--
-- Rollback: DROP TABLE public.saved_views; DROP FUNCTION public.guard_saved_view();

CREATE TABLE public.saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope ~ '^(everything|mine|[0-9a-f-]{36})$'),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  query TEXT NOT NULL DEFAULT '' CHECK (char_length(query) <= 2000),
  mode TEXT NOT NULL DEFAULT 'list' CHECK (mode IN ('list', 'board', 'table')),
  is_shared BOOLEAN NOT NULL DEFAULT false,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_saved_views_scope ON public.saved_views(workspace_id, scope);
-- one shared default per place, one private default per person per place
CREATE UNIQUE INDEX idx_saved_views_shared_default ON public.saved_views(workspace_id, scope) WHERE is_default AND is_shared;
CREATE UNIQUE INDEX idx_saved_views_private_default ON public.saved_views(workspace_id, scope, owner_id) WHERE is_default AND NOT is_shared;

CREATE OR REPLACE FUNCTION public.guard_saved_view()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.name := btrim(NEW.name);
  IF TG_OP = 'INSERT' THEN
    NEW.owner_id := auth.uid();
    NEW.created_at := NOW();
    PERFORM pg_advisory_xact_lock(hashtext('saved_views:' || NEW.workspace_id::text || ':' || COALESCE(NEW.owner_id::text, '')));
    IF (SELECT count(*) FROM public.saved_views WHERE workspace_id = NEW.workspace_id AND scope = NEW.scope AND owner_id IS NOT DISTINCT FROM NEW.owner_id) >= 30 THEN
      RAISE EXCEPTION 'at most 30 saved views per place' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.scope IS DISTINCT FROM OLD.scope THEN
      RAISE EXCEPTION 'a saved view cannot move' USING ERRCODE = '42501';
    END IF;
    NEW.owner_id := OLD.owner_id;
    NEW.created_at := OLD.created_at;
  END IF;
  IF NEW.scope NOT IN ('everything', 'mine') AND NOT EXISTS (SELECT 1 FROM public.lists WHERE id::text = NEW.scope AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'that list belongs to another workspace' USING ERRCODE = '23514';
  END IF;
  IF NEW.is_shared AND NOT private.is_workspace_manager(NEW.workspace_id) THEN
    RAISE EXCEPTION 'only managers share views with the team' USING ERRCODE = '42501';
  END IF;
  -- setting a default clears the previous one of the same kind
  IF NEW.is_default THEN
    UPDATE public.saved_views SET is_default = false
    WHERE workspace_id = NEW.workspace_id AND scope = NEW.scope AND id <> NEW.id AND is_default AND is_shared = NEW.is_shared
      AND (NEW.is_shared OR owner_id = NEW.owner_id);
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_saved_view() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_saved_views_guard BEFORE INSERT OR UPDATE ON public.saved_views FOR EACH ROW EXECUTE FUNCTION public.guard_saved_view();

ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "saved_views_select" ON public.saved_views FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id) AND (is_shared OR owner_id = (SELECT auth.uid())));
CREATE POLICY "saved_views_insert" ON public.saved_views FOR INSERT TO authenticated
  WITH CHECK (private.is_internal_member(workspace_id));
CREATE POLICY "saved_views_update" ON public.saved_views FOR UPDATE TO authenticated
  USING (private.is_internal_member(workspace_id) AND (owner_id = (SELECT auth.uid()) AND NOT is_shared OR is_shared AND private.is_workspace_manager(workspace_id)))
  WITH CHECK (private.is_internal_member(workspace_id));
CREATE POLICY "saved_views_delete" ON public.saved_views FOR DELETE TO authenticated
  USING (private.is_internal_member(workspace_id) AND (owner_id = (SELECT auth.uid()) AND NOT is_shared OR is_shared AND private.is_workspace_manager(workspace_id)));
GRANT SELECT, DELETE ON TABLE public.saved_views TO authenticated;
GRANT INSERT (workspace_id, scope, name, query, mode, is_shared, is_default) ON TABLE public.saved_views TO authenticated;
GRANT UPDATE (name, query, mode, is_shared, is_default) ON TABLE public.saved_views TO authenticated;
GRANT ALL ON TABLE public.saved_views TO service_role;
REVOKE ALL ON TABLE public.saved_views FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.saved_views FROM authenticated;

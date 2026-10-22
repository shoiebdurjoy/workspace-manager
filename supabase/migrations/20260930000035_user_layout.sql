-- Migration 35: each person's own layout (sidebar favourites, which Home cards show and in what order).
--
-- user_layouts: one small JSON document per person per workspace, e.g.
--   { "favorites": ["<list id>", ...], "home": { "order": ["mywork", ...], "hidden": ["insights"] } }
-- It only changes what that person sees; it is never used for permissions. Everyone reads and writes only their own
-- row; at most 16 KB.
--
-- Rollback: DROP TABLE public.user_layouts;

CREATE TABLE public.user_layouts (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  layout JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(layout) = 'object' AND pg_column_size(layout) <= 16384),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, workspace_id)
);

ALTER TABLE public.user_layouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_layouts_own_select" ON public.user_layouts FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY "user_layouts_own_insert" ON public.user_layouts FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND private.is_workspace_member(workspace_id));
CREATE POLICY "user_layouts_own_update" ON public.user_layouts FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
GRANT SELECT ON TABLE public.user_layouts TO authenticated;
GRANT INSERT (user_id, workspace_id, layout) ON TABLE public.user_layouts TO authenticated;
GRANT UPDATE (layout) ON TABLE public.user_layouts TO authenticated;
GRANT ALL ON TABLE public.user_layouts TO service_role;
REVOKE ALL ON TABLE public.user_layouts FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.user_layouts FROM authenticated;

CREATE TRIGGER trg_user_layouts_touch BEFORE INSERT OR UPDATE ON public.user_layouts FOR EACH ROW EXECUTE FUNCTION public.touch_notification_prefs();

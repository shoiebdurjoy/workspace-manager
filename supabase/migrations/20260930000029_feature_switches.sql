-- Migration 29: feature switches (Settings > Customize workspace > Features), like ClickUp's ClickApps.
--
-- workspaces.settings->'features' holds { "<feature>": false } for every feature an Owner / Admin switched off;
-- anything missing is ON, so existing workspaces keep everything. Only the listed features can be switched, only
-- with true / false, through set_workspace_feature, which runs with the caller's rights (workspaces RLS: Owner / Admin).
-- Switching a feature off hides it in the app; it never deletes data, so switching it back on restores it.
--
-- Rollback: DROP FUNCTION public.set_workspace_feature(UUID, TEXT, BOOLEAN);
--   UPDATE public.workspaces SET settings = settings - 'features';

CREATE OR REPLACE FUNCTION public.set_workspace_feature(p_workspace_id UUID, p_feature TEXT, p_enabled BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  out JSONB;
BEGIN
  IF NOT private.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'only the owner or an admin can switch features' USING ERRCODE = '42501';
  END IF;
  IF p_feature NOT IN ('priorities', 'client_deadline', 'aspect_ratio', 'production_links', 'custom_fields', 'subtasks',
                       'batch_videos', 'availability', 'assistant', 'calendar', 'workload', 'reports', 'production') THEN
    RAISE EXCEPTION 'unknown feature %', p_feature USING ERRCODE = '22023';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'a feature is switched on or off' USING ERRCODE = '22023';
  END IF;
  UPDATE public.workspaces
  SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{features}',
        CASE WHEN p_enabled THEN COALESCE(settings->'features', '{}'::jsonb) - p_feature
             ELSE COALESCE(settings->'features', '{}'::jsonb) || jsonb_build_object(p_feature, false) END, true),
      updated_at = NOW()
  WHERE id = p_workspace_id
  RETURNING settings->'features' INTO out;
  RETURN COALESCE(out, '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.set_workspace_feature(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_workspace_feature(UUID, TEXT, BOOLEAN) TO authenticated;

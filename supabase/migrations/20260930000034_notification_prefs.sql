-- Migration 34: each person chooses what notifies them (Profile > Notifications), like ClickUp's notification settings.
--
-- notification_prefs: one row per person per workspace (missing = everything on).
--   muted_kinds     any of 'mention', 'comment', 'assigned', 'status', 'automation' (automation = notices sent by
--                   automations, which are 'status' notifications carrying an automation name)
--   muted_list_ids  clients (lists) they do not want to hear about at all
-- The database applies them when a notification is created: a muted one is simply not created. Everyone reads and
-- writes only their own row.
--
-- Rollback: DROP TRIGGER trg_notifications_prefs ON public.notifications; DROP FUNCTION public.apply_notification_prefs();
--   DROP TABLE public.notification_prefs;

CREATE TABLE public.notification_prefs (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  muted_kinds TEXT[] NOT NULL DEFAULT '{}' CHECK (muted_kinds <@ ARRAY['mention', 'comment', 'assigned', 'status', 'automation']::TEXT[]),
  muted_list_ids UUID[] NOT NULL DEFAULT '{}' CHECK (cardinality(muted_list_ids) <= 500),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, workspace_id)
);

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notification_prefs_own_select" ON public.notification_prefs FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY "notification_prefs_own_insert" ON public.notification_prefs FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND private.is_workspace_member(workspace_id));
CREATE POLICY "notification_prefs_own_update" ON public.notification_prefs FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
GRANT SELECT ON TABLE public.notification_prefs TO authenticated;
GRANT INSERT (user_id, workspace_id, muted_kinds, muted_list_ids) ON TABLE public.notification_prefs TO authenticated;
GRANT UPDATE (muted_kinds, muted_list_ids) ON TABLE public.notification_prefs TO authenticated;
GRANT ALL ON TABLE public.notification_prefs TO service_role;
REVOKE ALL ON TABLE public.notification_prefs FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.notification_prefs FROM authenticated;

CREATE OR REPLACE FUNCTION public.apply_notification_prefs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p RECORD;
  kind TEXT := CASE WHEN NEW.kind = 'status' AND NEW.data ? 'automation' THEN 'automation' ELSE NEW.kind END;
BEGIN
  SELECT muted_kinds, muted_list_ids INTO p FROM public.notification_prefs WHERE user_id = NEW.user_id AND workspace_id = NEW.workspace_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF kind = ANY (p.muted_kinds) THEN
    RETURN NULL;
  END IF;
  IF cardinality(p.muted_list_ids) > 0 AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = NEW.task_id AND t.list_id = ANY (p.muted_list_ids)) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_notification_prefs() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_notifications_prefs BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.apply_notification_prefs();

CREATE OR REPLACE FUNCTION public.touch_notification_prefs()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_notification_prefs_touch BEFORE INSERT OR UPDATE ON public.notification_prefs FOR EACH ROW EXECUTE FUNCTION public.touch_notification_prefs();

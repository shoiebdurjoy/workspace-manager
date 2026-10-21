-- ==============================================================================
-- Migration 14: activity feed and notifications (Phase 10)
-- ==============================================================================
-- Two things that only mean something if they are TRUE, so both are written by the database itself,
-- inside the same transaction as the change they describe. Nothing in the app can write either table.
--
--   task_activity   what happened to a task, from real events: created, a property changed, someone
--                   assigned / unassigned, a comment, a file added / removed. Status changes are NOT
--                   copied here: task_status_events (migration 8) already is that history, and the task
--                   feed reads both. No history is back-filled: before this migration nothing was
--                   recorded, and it is not invented now.
--
--   notifications   what a person should be told: mentioned in a comment, assigned to a task, a comment on
--                   a task they work on, their task moved to another stage. One row per person per event
--                   (UNIQUE (user_id, dedupe_key), so a retry or a re-run can never notify twice). A row is
--                   only ever created for an ACTIVE STAFF MEMBER OF THAT WORKSPACE, never for the person who
--                   caused the event. A recipient can only read their own rows and change one thing on
--                   them: whether they have read it.
--
-- The rows reference the task, so removing a task removes its activity and notifications.
-- Realtime: notifications are added to the supabase_realtime publication (when it exists), so the bell
-- updates live; Realtime applies the table's RLS, a person only receives their own rows.
--
-- Rollback (loses the feed and all notifications):
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.notifications;   -- if it was added
--   DROP TRIGGER trg_tasks_activity ON public.tasks;
--   DROP TRIGGER trg_task_assignees_activity ON public.task_assignees;
--   DROP TRIGGER trg_task_comments_activity ON public.task_comments;
--   DROP TRIGGER trg_task_attachments_activity ON public.task_attachments;
--   DROP TRIGGER trg_task_status_events_notify ON public.task_status_events;
--   DROP TABLE public.notifications; DROP TABLE public.task_activity;
--   DROP FUNCTION public.log_task_activity(), public.log_assignee_activity(), public.log_comment_activity(),
--     public.log_attachment_activity(), public.notify_status_change(), public.guard_notification(),
--     private.log_activity(UUID, UUID, UUID, TEXT, JSONB), private.notify(UUID, UUID, UUID, UUID, TEXT, TEXT, JSONB);
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Tables
-- ------------------------------------------------------------------------------

CREATE TABLE public.task_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'created', 'updated', 'assigned', 'unassigned', 'commented', 'attachment_added', 'attachment_removed'
  )),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_task_activity_task ON public.task_activity(task_id, created_at DESC, id);
CREATE INDEX idx_task_activity_workspace ON public.task_activity(workspace_id);

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mention', 'comment', 'assigned', 'status')),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, dedupe_key)
);
-- the bell: newest first for one person, and the unread count
CREATE INDEX idx_notifications_user ON public.notifications(user_id, created_at DESC, id);
CREATE INDEX idx_notifications_unread ON public.notifications(user_id) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_task ON public.notifications(task_id);
CREATE INDEX idx_notifications_workspace ON public.notifications(workspace_id);

-- ------------------------------------------------------------------------------
-- 2. Writers (database-internal only)
-- ------------------------------------------------------------------------------

-- Record one activity row, unless the task (or its workspace) is already being deleted: a cascade removes
-- the children after the parent, and a row pointing at a vanished parent would fail the whole delete.
CREATE OR REPLACE FUNCTION private.log_activity(p_task UUID, p_ws UUID, p_actor UUID, p_kind TEXT, p_data JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks t JOIN public.workspaces w ON w.id = t.workspace_id
    WHERE t.id = p_task AND w.id = p_ws
  ) THEN
    RETURN;
  END IF;
  INSERT INTO public.task_activity (task_id, workspace_id, actor_id, kind, data)
  VALUES (p_task, p_ws, p_actor, p_kind, COALESCE(p_data, '{}'::jsonb));
END;
$$;

-- Notify one person, once. Never the person who did it, never someone who is not active staff of the workspace.
CREATE OR REPLACE FUNCTION private.notify(
  p_user UUID, p_ws UUID, p_task UUID, p_actor UUID, p_kind TEXT, p_key TEXT, p_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_user IS NULL OR p_user IS NOT DISTINCT FROM p_actor THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    JOIN public.profiles p ON p.id = wm.user_id AND p.is_active
    WHERE wm.workspace_id = p_ws AND wm.user_id = p_user
      AND wm.role IN ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST', 'EDITOR')
  ) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = p_task AND t.workspace_id = p_ws) THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (user_id, workspace_id, task_id, actor_id, kind, data, dedupe_key)
  VALUES (p_user, p_ws, p_task, p_actor, p_kind, COALESCE(p_data, '{}'::jsonb), p_key)
  ON CONFLICT (user_id, dedupe_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION private.log_activity(UUID, UUID, UUID, TEXT, JSONB),
  private.notify(UUID, UUID, UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.log_activity(UUID, UUID, UUID, TEXT, JSONB),
  private.notify(UUID, UUID, UUID, UUID, TEXT, TEXT, JSONB) TO service_role;

-- ------------------------------------------------------------------------------
-- 3. Triggers: task properties
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_task_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  changes JSONB := '[]'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM private.log_activity(NEW.id, NEW.workspace_id, auth.uid(), 'created', jsonb_build_object('title', NEW.title));
    RETURN NULL;
  END IF;

  -- small values are recorded as from -> to; long text and links only record that they changed
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    changes := changes || jsonb_build_array(jsonb_build_object('field', 'title', 'from', OLD.title, 'to', NEW.title));
  END IF;
  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    changes := changes || jsonb_build_array(jsonb_build_object('field', 'priority', 'from', OLD.priority, 'to', NEW.priority));
  END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    changes := changes || jsonb_build_array(jsonb_build_object('field', 'due_date', 'from', OLD.due_date, 'to', NEW.due_date));
  END IF;
  IF NEW.client_deadline IS DISTINCT FROM OLD.client_deadline THEN
    changes := changes || jsonb_build_array(jsonb_build_object('field', 'client_deadline', 'from', OLD.client_deadline, 'to', NEW.client_deadline));
  END IF;
  IF NEW.aspect_ratio IS DISTINCT FROM OLD.aspect_ratio THEN
    changes := changes || jsonb_build_array(jsonb_build_object('field', 'aspect_ratio', 'from', OLD.aspect_ratio, 'to', NEW.aspect_ratio));
  END IF;
  IF NEW.list_id IS DISTINCT FROM OLD.list_id THEN
    changes := changes || jsonb_build_array(jsonb_build_object('field', 'list', 'from', OLD.list_id, 'to', NEW.list_id));
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    changes := changes || jsonb_build_array(jsonb_build_object('field', 'description', 'changed', true));
  END IF;
  IF NEW.raw_footage_link IS DISTINCT FROM OLD.raw_footage_link THEN
    changes := changes || jsonb_build_array(jsonb_build_object('field', 'raw_footage_link', 'changed', true));
  END IF;
  IF NEW.project_file_link IS DISTINCT FROM OLD.project_file_link THEN
    changes := changes || jsonb_build_array(jsonb_build_object('field', 'project_file_link', 'changed', true));
  END IF;
  IF NEW.review_link IS DISTINCT FROM OLD.review_link THEN
    changes := changes || jsonb_build_array(jsonb_build_object('field', 'review_link', 'changed', true));
  END IF;
  IF NEW.final_export_link IS DISTINCT FROM OLD.final_export_link THEN
    changes := changes || jsonb_build_array(jsonb_build_object('field', 'final_export_link', 'changed', true));
  END IF;

  IF jsonb_array_length(changes) > 0 THEN
    PERFORM private.log_activity(NEW.id, NEW.workspace_id, auth.uid(), 'updated', jsonb_build_object('changes', changes));
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_tasks_activity AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_task_activity();

-- ------------------------------------------------------------------------------
-- 4. Triggers: assignments
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_assignee_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  title TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM private.log_activity(OLD.task_id, OLD.workspace_id, auth.uid(), 'unassigned',
      jsonb_build_object('role_type', OLD.role_type, 'user_id', OLD.user_id));
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
    RETURN NULL;
  END IF;

  PERFORM private.log_activity(NEW.task_id, NEW.workspace_id, auth.uid(), 'assigned',
    jsonb_build_object('role_type', NEW.role_type, 'user_id', NEW.user_id,
      'previous_user_id', CASE WHEN TG_OP = 'UPDATE' THEN OLD.user_id END));

  SELECT t.title INTO title FROM public.tasks t WHERE t.id = NEW.task_id;
  PERFORM private.notify(
    NEW.user_id, NEW.workspace_id, NEW.task_id, auth.uid(), 'assigned',
    -- the time is part of the key: being assigned, removed, and assigned again is a new event
    'assigned:' || NEW.task_id || ':' || NEW.role_type || ':' || NEW.user_id || ':' || extract(epoch FROM NEW.assigned_at)::text,
    jsonb_build_object('title', title, 'role_type', NEW.role_type)
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_task_assignees_activity AFTER INSERT OR UPDATE OR DELETE ON public.task_assignees
  FOR EACH ROW EXECUTE FUNCTION public.log_assignee_activity();

-- ------------------------------------------------------------------------------
-- 5. Triggers: comments (activity + mentions + the people working on the task)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_comment_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  title TEXT;
  who UUID;
  snippet TEXT;
BEGIN
  SELECT t.title INTO title FROM public.tasks t WHERE t.id = NEW.task_id;
  snippet := LEFT(regexp_replace(regexp_replace(NEW.body, '@\[([^\]\n]{1,100})\]\([0-9a-fA-F-]{36}\)', '@\1', 'g'), '\s+', ' ', 'g'), 140);

  IF TG_OP = 'INSERT' THEN
    PERFORM private.log_activity(NEW.task_id, NEW.workspace_id, NEW.author_id, 'commented',
      jsonb_build_object('comment_id', NEW.id));
  END IF;

  -- everyone the text mentions (also people added by an edit; the key stops a second notice for the same comment)
  FOREACH who IN ARRAY NEW.mentions LOOP
    PERFORM private.notify(who, NEW.workspace_id, NEW.task_id, NEW.author_id, 'mention',
      'mention:' || NEW.id || ':' || who,
      jsonb_build_object('title', title, 'comment_id', NEW.id, 'snippet', snippet));
  END LOOP;

  -- the editor and QC reviewer of the task hear about a new comment (unless they were mentioned: that is the better notice)
  IF TG_OP = 'INSERT' THEN
    FOR who IN
      SELECT a.user_id FROM public.task_assignees a
      WHERE a.task_id = NEW.task_id AND NOT (a.user_id = ANY (NEW.mentions))
    LOOP
      PERFORM private.notify(who, NEW.workspace_id, NEW.task_id, NEW.author_id, 'comment',
        'comment:' || NEW.id || ':' || who,
        jsonb_build_object('title', title, 'comment_id', NEW.id, 'snippet', snippet));
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_task_comments_activity AFTER INSERT OR UPDATE OF body ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.log_comment_activity();

-- ------------------------------------------------------------------------------
-- 6. Triggers: attachments
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_attachment_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM private.log_activity(NEW.task_id, NEW.workspace_id, auth.uid(), 'attachment_added',
      jsonb_build_object('attachment_id', NEW.id, 'file_name', NEW.file_name, 'size_bytes', NEW.size_bytes));
  ELSE
    PERFORM private.log_activity(OLD.task_id, OLD.workspace_id, auth.uid(), 'attachment_removed',
      jsonb_build_object('attachment_id', OLD.id, 'file_name', OLD.file_name));
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_task_attachments_activity AFTER INSERT OR DELETE ON public.task_attachments
  FOR EACH ROW EXECUTE FUNCTION public.log_attachment_activity();

-- ------------------------------------------------------------------------------
-- 7. Trigger: a task moved to another stage -> the people working on it
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  title TEXT;
  who UUID;
BEGIN
  SELECT t.title INTO title FROM public.tasks t WHERE t.id = NEW.task_id;
  FOR who IN SELECT a.user_id FROM public.task_assignees a WHERE a.task_id = NEW.task_id LOOP
    PERFORM private.notify(who, NEW.workspace_id, NEW.task_id, NEW.actor_id, 'status',
      'status:' || NEW.id || ':' || who,
      jsonb_build_object('title', title, 'from', NEW.from_status, 'to', NEW.to_status, 'event_id', NEW.id));
  END LOOP;
  RETURN NULL;
END;
$$;

-- the first row of a task's history (no from_status) is its creation, not a move
CREATE TRIGGER trg_task_status_events_notify AFTER INSERT ON public.task_status_events
  FOR EACH ROW WHEN (NEW.from_status IS NOT NULL) EXECUTE FUNCTION public.notify_status_change();

REVOKE ALL ON FUNCTION public.log_task_activity(), public.log_assignee_activity(), public.log_comment_activity(),
  public.log_attachment_activity(), public.notify_status_change() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 8. Notification guard: the only thing a recipient changes is whether they have read it
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- the one change that is not a read: the actor's account was deleted (ON DELETE SET NULL, profile already gone)
  IF NEW.actor_id IS NULL AND OLD.actor_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.actor_id) THEN
    NEW.actor_id := NULL;
    IF NEW.read_at IS NOT DISTINCT FROM OLD.read_at THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.data IS DISTINCT FROM OLD.data OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'only the read state of a notification can be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.read_at IS NOT NULL THEN
    -- the time is the server's, and an already-read notification keeps its first read time
    NEW.read_at := COALESCE(OLD.read_at, NOW());
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_notification() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_notifications_guard BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_notification();

-- ------------------------------------------------------------------------------
-- 9. RLS and grants
-- ------------------------------------------------------------------------------

ALTER TABLE public.task_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_activity_select" ON public.task_activity FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id));
GRANT SELECT ON TABLE public.task_activity TO authenticated;
GRANT ALL ON TABLE public.task_activity TO service_role;
REVOKE ALL ON TABLE public.task_activity FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.task_activity FROM authenticated;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
-- yours only, and only while you can still see the workspace
CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND private.is_internal_member(workspace_id));
CREATE POLICY "notifications_update_own" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND private.is_internal_member(workspace_id))
  WITH CHECK (user_id = (SELECT auth.uid()) AND private.is_internal_member(workspace_id));
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT UPDATE (read_at) ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;
REVOKE ALL ON TABLE public.notifications FROM anon;
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.notifications FROM authenticated;

-- ------------------------------------------------------------------------------
-- 10. Realtime (only where the publication exists: not in a plain Postgres)
-- ------------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END;
$$;

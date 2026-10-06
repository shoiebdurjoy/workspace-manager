-- ==============================================================================
-- Migration: 20260930000004_private_helpers_and_initplan.sql
-- Purpose : Clear the two groups of Supabase advisor warnings.
--
--  1. authenticated_security_definer_function_executable (8 helpers)
--     The authorization helpers are SECURITY DEFINER functions that lived in the
--     `public` schema, which the Data API exposes, so signed-in users could call them
--     through /rest/v1/rpc/. They now live in a `private` schema that is NOT exposed
--     (config.toml [api].schemas and the project's "Exposed schemas" setting list only
--     public + graphql_public). RLS policies still call them because policies run as the
--     signed-in role, which keeps USAGE on the schema and EXECUTE on the functions.
--
--  2. auth_rls_initplan
--     Policies now use (SELECT auth.uid()) so Postgres evaluates it once per query
--     instead of once per row.
--
-- Everything below runs in one transaction (supabase db push wraps each migration), so
-- there is no window in which the policies point at a missing function.
-- DO NOT add private to the API's exposed schemas.
--
-- Rollback: restore migration 1's public helpers and policies (not expected to be needed).
-- ==============================================================================

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 1. Helpers (same logic as migration 1, new schema)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.workspace_role(ws_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.role::text
  FROM public.workspace_members m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.workspace_id = ws_id
    AND m.user_id = auth.uid()
    AND p.is_active
$$;

CREATE OR REPLACE FUNCTION private.is_workspace_member(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.workspace_role(ws_id) IS NOT NULL
$$;

-- Everyone except CLIENT_VIEWER
CREATE OR REPLACE FUNCTION private.is_internal_member(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(private.workspace_role(ws_id) IN
    ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST', 'EDITOR'), false)
$$;

CREATE OR REPLACE FUNCTION private.is_workspace_manager(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(private.workspace_role(ws_id) IN
    ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER'), false)
$$;

CREATE OR REPLACE FUNCTION private.is_workspace_admin(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(private.workspace_role(ws_id) IN ('OWNER', 'ADMIN'), false)
$$;

CREATE OR REPLACE FUNCTION private.is_workspace_owner(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(private.workspace_role(ws_id) = 'OWNER', false)
$$;

CREATE OR REPLACE FUNCTION private.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_active
  )
$$;

-- True when the caller is an internal member of a workspace that target_user
-- also belongs to. Used so staff can see each other's profile, nobody else's.
CREATE OR REPLACE FUNCTION private.shares_workspace_with(target_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members me
    JOIN public.workspace_members them ON them.workspace_id = me.workspace_id
    JOIN public.profiles p ON p.id = me.user_id
    WHERE me.user_id = auth.uid()
      AND p.is_active
      AND me.role IN ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST', 'EDITOR')
      AND them.user_id = target_user
  )
$$;

REVOKE ALL ON FUNCTION
  private.workspace_role(UUID), private.is_workspace_member(UUID),
  private.is_internal_member(UUID), private.is_workspace_manager(UUID),
  private.is_workspace_admin(UUID), private.is_workspace_owner(UUID),
  private.is_active_user(), private.shares_workspace_with(UUID)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  private.workspace_role(UUID), private.is_workspace_member(UUID),
  private.is_internal_member(UUID), private.is_workspace_manager(UUID),
  private.is_workspace_admin(UUID), private.is_workspace_owner(UUID),
  private.is_active_user(), private.shares_workspace_with(UUID)
TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. Guard triggers that call a helper (re-created against private.workspace_role)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_task_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r TEXT;
  late TEXT[] := ARRAY['READY_TO_DELIVER', 'CLIENT_REVIEW', 'COMPLETED', 'CLOSED'];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  r := private.workspace_role(OLD.workspace_id);

  IF r IN ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER') THEN
    RETURN NEW;
  END IF;

  IF r IN ('QC_SPECIALIST', 'EDITOR') THEN
    IF (to_jsonb(NEW) - ARRAY['status', 'position', 'updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'position', 'updated_at']) THEN
      RAISE EXCEPTION 'your role may only change a task''s status and position'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF r = 'QC_SPECIALIST'
         AND (NEW.status IN ('COMPLETED', 'CLOSED') OR OLD.status IN ('COMPLETED', 'CLOSED')) THEN
        RAISE EXCEPTION 'QC specialists cannot complete, close or reopen tasks'
          USING ERRCODE = '42501';
      END IF;
      IF r = 'EDITOR' AND (NEW.status = ANY (late) OR OLD.status = ANY (late)) THEN
        RAISE EXCEPTION 'editors cannot move tasks into or out of QC-approved and later stages'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'your role cannot modify tasks' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_subtask_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  r := private.workspace_role(OLD.workspace_id);

  IF r IN ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER') THEN
    RETURN NEW;
  END IF;

  IF r IN ('QC_SPECIALIST', 'EDITOR') THEN
    IF (to_jsonb(NEW) - ARRAY['is_completed', 'position', 'updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['is_completed', 'position', 'updated_at']) THEN
      RAISE EXCEPTION 'your role may only tick or reorder subtasks'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'your role cannot modify subtasks' USING ERRCODE = '42501';
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. Policies: re-created against private helpers and (SELECT auth.uid())
-- ------------------------------------------------------------------------------

-- 7.1 PROFILES  (no INSERT policy: only the handle_new_user trigger creates rows)
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR private.shares_workspace_with(id));

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- 7.2 WORKSPACES
-- owner_id = (SELECT auth.uid()) lets the creator read the row back from INSERT ... RETURNING
-- before the membership trigger row is visible to the policy.
DROP POLICY IF EXISTS "workspaces_select" ON public.workspaces;
CREATE POLICY "workspaces_select"
  ON public.workspaces FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) OR private.is_workspace_member(id));

DROP POLICY IF EXISTS "workspaces_insert" ON public.workspaces;
CREATE POLICY "workspaces_insert"
  ON public.workspaces FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()) AND private.is_active_user());

DROP POLICY IF EXISTS "workspaces_update" ON public.workspaces;
CREATE POLICY "workspaces_update"
  ON public.workspaces FOR UPDATE TO authenticated
  USING (private.is_workspace_admin(id))
  WITH CHECK (private.is_workspace_admin(id));

DROP POLICY IF EXISTS "workspaces_delete" ON public.workspaces;
CREATE POLICY "workspaces_delete"
  ON public.workspaces FOR DELETE TO authenticated
  USING (private.is_workspace_owner(id));

-- 7.3 WORKSPACE MEMBERS
-- Admins manage members but can never create, change or remove an OWNER.
DROP POLICY IF EXISTS "workspace_members_select" ON public.workspace_members;
CREATE POLICY "workspace_members_select"
  ON public.workspace_members FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR private.is_internal_member(workspace_id));

DROP POLICY IF EXISTS "workspace_members_insert" ON public.workspace_members;
CREATE POLICY "workspace_members_insert"
  ON public.workspace_members FOR INSERT TO authenticated
  WITH CHECK (
    private.is_workspace_owner(workspace_id)
    OR (private.is_workspace_admin(workspace_id) AND role <> 'OWNER')
  );

DROP POLICY IF EXISTS "workspace_members_update" ON public.workspace_members;
CREATE POLICY "workspace_members_update"
  ON public.workspace_members FOR UPDATE TO authenticated
  USING (
    private.is_workspace_owner(workspace_id)
    OR (private.is_workspace_admin(workspace_id) AND role <> 'OWNER')
  )
  WITH CHECK (
    private.is_workspace_owner(workspace_id)
    OR (private.is_workspace_admin(workspace_id) AND role <> 'OWNER')
  );

DROP POLICY IF EXISTS "workspace_members_delete" ON public.workspace_members;
CREATE POLICY "workspace_members_delete"
  ON public.workspace_members FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR private.is_workspace_owner(workspace_id)
    OR (private.is_workspace_admin(workspace_id) AND role <> 'OWNER')
  );

-- 7.4 SPACES (OWNER/ADMIN manage)
DROP POLICY IF EXISTS "spaces_select" ON public.spaces;
CREATE POLICY "spaces_select"
  ON public.spaces FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id));

DROP POLICY IF EXISTS "spaces_insert" ON public.spaces;
CREATE POLICY "spaces_insert"
  ON public.spaces FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "spaces_update" ON public.spaces;
CREATE POLICY "spaces_update"
  ON public.spaces FOR UPDATE TO authenticated
  USING (private.is_workspace_admin(workspace_id))
  WITH CHECK (private.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "spaces_delete" ON public.spaces;
CREATE POLICY "spaces_delete"
  ON public.spaces FOR DELETE TO authenticated
  USING (private.is_workspace_admin(workspace_id));

-- 7.5 FOLDERS (managers create/edit, admins delete)
DROP POLICY IF EXISTS "folders_select" ON public.folders;
CREATE POLICY "folders_select"
  ON public.folders FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id));

DROP POLICY IF EXISTS "folders_insert" ON public.folders;
CREATE POLICY "folders_insert"
  ON public.folders FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_manager(workspace_id));

DROP POLICY IF EXISTS "folders_update" ON public.folders;
CREATE POLICY "folders_update"
  ON public.folders FOR UPDATE TO authenticated
  USING (private.is_workspace_manager(workspace_id))
  WITH CHECK (private.is_workspace_manager(workspace_id));

DROP POLICY IF EXISTS "folders_delete" ON public.folders;
CREATE POLICY "folders_delete"
  ON public.folders FOR DELETE TO authenticated
  USING (private.is_workspace_admin(workspace_id));

-- 7.6 LISTS
DROP POLICY IF EXISTS "lists_select" ON public.lists;
CREATE POLICY "lists_select"
  ON public.lists FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id));

DROP POLICY IF EXISTS "lists_insert" ON public.lists;
CREATE POLICY "lists_insert"
  ON public.lists FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_manager(workspace_id));

DROP POLICY IF EXISTS "lists_update" ON public.lists;
CREATE POLICY "lists_update"
  ON public.lists FOR UPDATE TO authenticated
  USING (private.is_workspace_manager(workspace_id))
  WITH CHECK (private.is_workspace_manager(workspace_id));

DROP POLICY IF EXISTS "lists_delete" ON public.lists;
CREATE POLICY "lists_delete"
  ON public.lists FOR DELETE TO authenticated
  USING (private.is_workspace_admin(workspace_id));

-- 7.7 TASKS (managers create/delete; QC and editors update status/position only,
--     enforced by guard_task_update)
DROP POLICY IF EXISTS "tasks_select" ON public.tasks;
CREATE POLICY "tasks_select"
  ON public.tasks FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id));

DROP POLICY IF EXISTS "tasks_insert" ON public.tasks;
CREATE POLICY "tasks_insert"
  ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_manager(workspace_id));

DROP POLICY IF EXISTS "tasks_update" ON public.tasks;
CREATE POLICY "tasks_update"
  ON public.tasks FOR UPDATE TO authenticated
  USING (private.is_internal_member(workspace_id))
  WITH CHECK (private.is_internal_member(workspace_id));

DROP POLICY IF EXISTS "tasks_delete" ON public.tasks;
CREATE POLICY "tasks_delete"
  ON public.tasks FOR DELETE TO authenticated
  USING (private.is_workspace_manager(workspace_id));

-- 7.8 SUBTASKS
DROP POLICY IF EXISTS "subtasks_select" ON public.subtasks;
CREATE POLICY "subtasks_select"
  ON public.subtasks FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id));

DROP POLICY IF EXISTS "subtasks_insert" ON public.subtasks;
CREATE POLICY "subtasks_insert"
  ON public.subtasks FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_manager(workspace_id));

DROP POLICY IF EXISTS "subtasks_update" ON public.subtasks;
CREATE POLICY "subtasks_update"
  ON public.subtasks FOR UPDATE TO authenticated
  USING (private.is_internal_member(workspace_id))
  WITH CHECK (private.is_internal_member(workspace_id));

DROP POLICY IF EXISTS "subtasks_delete" ON public.subtasks;
CREATE POLICY "subtasks_delete"
  ON public.subtasks FOR DELETE TO authenticated
  USING (private.is_workspace_manager(workspace_id));

-- ------------------------------------------------------------------------------
-- 4. Remove the old public helpers (nothing depends on them any more)
-- ------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.workspace_role(UUID);
DROP FUNCTION IF EXISTS public.is_workspace_member(UUID);
DROP FUNCTION IF EXISTS public.is_internal_member(UUID);
DROP FUNCTION IF EXISTS public.is_workspace_manager(UUID);
DROP FUNCTION IF EXISTS public.is_workspace_admin(UUID);
DROP FUNCTION IF EXISTS public.is_workspace_owner(UUID);
DROP FUNCTION IF EXISTS public.is_active_user();
DROP FUNCTION IF EXISTS public.shares_workspace_with(UUID);

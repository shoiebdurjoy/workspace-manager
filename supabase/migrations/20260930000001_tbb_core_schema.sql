-- ==============================================================================
-- TBB WORKSPACE V2 — CORE DATABASE SCHEMA & RLS MIGRATION
-- Migration: 20260930000001_tbb_core_schema.sql
-- Target: PostgreSQL 15+ (Supabase)
-- Scope: Phase 3 — Backend + Database Foundation
-- Hierarchy: Workspace -> Space -> Folder -> List -> Task -> Subtask
--
-- SECURITY MODEL (read this before editing policies)
--   * Authorization is decided by workspace_members.role, never by profiles.role.
--     profiles.role is an account label that users cannot change themselves.
--   * Profiles are created by the handle_new_user trigger on auth.users, always
--     with role EDITOR. Clients never choose their own role.
--   * RLS decides WHICH ROWS a user can touch; BEFORE UPDATE guard triggers decide
--     WHICH COLUMNS non-managers may change (RLS cannot express column rules).
--   * Guard triggers are skipped only when auth.uid() IS NULL, i.e. for the
--     service role, the SQL editor and migrations. Never for browser users.
--   * All SECURITY DEFINER functions pin search_path to '' and are not callable
--     by the anon role.
--
-- KNOWN LIMITATIONS (deliberate, tracked for later phases)
--   * Tasks have no assignee column yet, so EDITOR/QC cannot be limited to
--     "their own" tasks. They can only change status/position, and an EDITOR can
--     never move a task into or out of a late-stage status. (Phase 6 adds
--     assignees; tighten then.)
--   * CLIENT_VIEWER has no access to spaces/folders/lists/tasks until per-list
--     guest grants exist. Fail closed.
--   * Private spaces are disabled (CHECK below) until space_members exists.
--   * Task status/priority are CHECK constraints. Phase 7 replaces status with a
--     configurable workflow (workflows/statuses tables).
--   * Any signed-in, active user may create a workspace (they become its OWNER)
--     and sees only workspaces they belong to. Disable public sign-ups in the
--     Supabase Auth settings so only invited people can obtain an account.
-- ==============================================================================

-- ==============================================================================
-- 1. TRIGGER UTILITIES
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ==============================================================================
-- 2. TABLES
-- ==============================================================================

-- 2.1 PROFILES (1-to-1 with auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  -- Account label only. NOT used for authorization (see workspace_members.role).
  role VARCHAR(50) NOT NULL DEFAULT 'EDITOR' CHECK (role IN (
    'OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST', 'EDITOR', 'CLIENT_VIEWER'
  )),
  phone VARCHAR(50),
  timezone VARCHAR(50) DEFAULT 'UTC',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.2 WORKSPACES (root organizational unit)
CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL CHECK (length(btrim(name)) > 0),
  slug VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  logo_url TEXT,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.3 WORKSPACE MEMBERS (explicit membership and the authoritative role)
CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'EDITOR' CHECK (role IN (
    'OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST', 'EDITOR', 'CLIENT_VIEWER'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

-- 2.4 SPACES (operational divisions)
CREATE TABLE IF NOT EXISTS public.spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL CHECK (length(btrim(name)) > 0),
  slug VARCHAR(255) NOT NULL,
  description TEXT,
  icon VARCHAR(50) DEFAULT 'folder',
  color VARCHAR(50) DEFAULT '#7B68EE',
  -- Private spaces need a space_members table that does not exist yet.
  -- Fail closed: no private spaces until access control for them is built.
  is_private BOOLEAN NOT NULL DEFAULT false CHECK (is_private = false),
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, slug)
);

-- 2.5 FOLDERS (client pods / pipelines within a space)
-- workspace_id is denormalised for cheap RLS; a trigger derives it from the space.
CREATE TABLE IF NOT EXISTS public.folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL CHECK (length(btrim(name)) > 0),
  description TEXT,
  position INT NOT NULL DEFAULT 0,
  is_collapsed_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, space_id)
);

-- 2.6 LISTS (deliverable queues / client accounts)
-- The composite FK guarantees a list's folder belongs to the SAME space.
-- Deleting a folder that still contains lists is refused (no silent orphaning).
CREATE TABLE IF NOT EXISTS public.lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  folder_id UUID,
  name VARCHAR(255) NOT NULL CHECK (length(btrim(name)) > 0),
  description TEXT,
  color VARCHAR(50) DEFAULT '#7B68EE',
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lists_folder_space_fkey
    FOREIGN KEY (folder_id, space_id) REFERENCES public.folders(id, space_id)
);

-- 2.7 TASKS (deliverable foundation)
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  list_id UUID NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL CHECK (length(btrim(title)) > 0),
  description TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'TODO' CHECK (status IN (
    'TODO', 'IN_PROGRESS', 'IN_QC', 'READY_TO_DELIVER', 'CLIENT_REVIEW', 'COMPLETED', 'CLOSED'
  )),
  priority VARCHAR(50) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN (
    'URGENT', 'HIGH', 'MEDIUM', 'LOW'
  )),
  position INT NOT NULL DEFAULT 0,
  due_date TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.8 SUBTASKS (sub-deliverable units)
CREATE TABLE IF NOT EXISTS public.subtasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL CHECK (length(btrim(title)) > 0),
  description TEXT,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  position INT NOT NULL DEFAULT 0,
  due_date TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 3. INDEXES
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON public.workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_spaces_workspace_pos ON public.spaces(workspace_id, position);
CREATE INDEX IF NOT EXISTS idx_folders_workspace ON public.folders(workspace_id);
CREATE INDEX IF NOT EXISTS idx_folders_space_pos ON public.folders(space_id, position);
CREATE INDEX IF NOT EXISTS idx_lists_workspace ON public.lists(workspace_id);
CREATE INDEX IF NOT EXISTS idx_lists_space_pos ON public.lists(space_id, position);
CREATE INDEX IF NOT EXISTS idx_lists_folder_pos ON public.lists(folder_id, position);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status ON public.tasks(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_list_pos ON public.tasks(list_id, position);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(list_id, status);
CREATE INDEX IF NOT EXISTS idx_subtasks_workspace ON public.subtasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_task_pos ON public.subtasks(task_id, position);

-- ==============================================================================
-- 4. AUTHORIZATION HELPERS
-- All helpers read auth.uid() themselves. They take NO user argument, so a caller
-- can only ever ask about their own membership. SECURITY DEFINER lets them read
-- workspace_members without recursing through its own RLS.
-- A deactivated profile (is_active = false) has no role anywhere.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.workspace_role(ws_id UUID)
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

CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.workspace_role(ws_id) IS NOT NULL
$$;

-- Everyone except CLIENT_VIEWER
CREATE OR REPLACE FUNCTION public.is_internal_member(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(public.workspace_role(ws_id) IN
    ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST', 'EDITOR'), false)
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_manager(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(public.workspace_role(ws_id) IN
    ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER'), false)
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(public.workspace_role(ws_id) IN ('OWNER', 'ADMIN'), false)
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_owner(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(public.workspace_role(ws_id) = 'OWNER', false)
$$;

CREATE OR REPLACE FUNCTION public.is_active_user()
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
CREATE OR REPLACE FUNCTION public.shares_workspace_with(target_user UUID)
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

-- ==============================================================================
-- 5. TRIGGER FUNCTIONS
-- ==============================================================================

-- 5.1 New auth user -> profile. Role is ALWAYS 'EDITOR'; user-supplied metadata
--     is never trusted for authorization.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
      NULLIF(btrim(NEW.raw_user_meta_data ->> 'name'), ''),
      split_part(NEW.email, '@', 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 5.2 Users may edit their own display fields, never their identity or status.
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- service role / SQL editor / migrations
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'id, email, role and is_active cannot be changed from the client'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- 5.3 Workspace creator becomes OWNER.
CREATE OR REPLACE FUNCTION public.handle_new_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'OWNER')
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'OWNER';
  RETURN NEW;
END;
$$;

-- 5.4 Workspace owner_id is immutable from the client.
CREATE OR REPLACE FUNCTION public.guard_workspace_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'workspace owner cannot be changed from the client'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- 5.5 Membership integrity: identity columns are fixed and a workspace can never
--     lose its last OWNER (unless the workspace itself is being deleted).
CREATE OR REPLACE FUNCTION public.guard_membership_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
                           OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'membership workspace_id and user_id cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.role = 'OWNER'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'OWNER')
     AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = OLD.workspace_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.workspace_members m
       WHERE m.workspace_id = OLD.workspace_id
         AND m.role = 'OWNER'
         AND m.user_id <> OLD.user_id
     ) THEN
    RAISE EXCEPTION 'a workspace must keep at least one OWNER'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- 5.6 Hierarchy integrity: workspace_id is always derived from the parent, never
--     trusted from the client, and rows can never be moved across workspaces.
CREATE OR REPLACE FUNCTION public.set_folder_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ws UUID;
BEGIN
  SELECT workspace_id INTO ws FROM public.spaces WHERE id = NEW.space_id;
  IF ws IS NULL THEN
    RAISE EXCEPTION 'space % does not exist', NEW.space_id USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' AND ws IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'folders cannot be moved to another workspace' USING ERRCODE = '42501';
  END IF;
  NEW.workspace_id := ws;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_list_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ws UUID;
BEGIN
  SELECT workspace_id INTO ws FROM public.spaces WHERE id = NEW.space_id;
  IF ws IS NULL THEN
    RAISE EXCEPTION 'space % does not exist', NEW.space_id USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' AND ws IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'lists cannot be moved to another workspace' USING ERRCODE = '42501';
  END IF;
  NEW.workspace_id := ws;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_task_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ws UUID;
BEGIN
  SELECT workspace_id INTO ws FROM public.lists WHERE id = NEW.list_id;
  IF ws IS NULL THEN
    RAISE EXCEPTION 'list % does not exist', NEW.list_id USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' AND ws IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'tasks cannot be moved to another workspace' USING ERRCODE = '42501';
  END IF;
  NEW.workspace_id := ws;
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_by := auth.uid();
    ELSE
      NEW.created_by := OLD.created_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_subtask_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ws UUID;
BEGIN
  SELECT workspace_id INTO ws FROM public.tasks WHERE id = NEW.task_id;
  IF ws IS NULL THEN
    RAISE EXCEPTION 'task % does not exist', NEW.task_id USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' AND ws IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'subtasks cannot be moved to another workspace' USING ERRCODE = '42501';
  END IF;
  NEW.workspace_id := ws;
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_by := auth.uid();
    ELSE
      NEW.created_by := OLD.created_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 5.7 Task column rules (RLS cannot restrict columns).
--     Managers: any field.  QC_SPECIALIST / EDITOR: status and position only.
--     QC cannot COMPLETE/CLOSE or reopen finished tasks.
--     EDITOR can never move a task into or out of a late-stage status, so an
--     editor can never approve their own work.
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

  r := public.workspace_role(OLD.workspace_id);

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

  r := public.workspace_role(OLD.workspace_id);

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

-- ==============================================================================
-- 6. TRIGGERS
-- (Postgres fires same-event triggers alphabetically by name.)
-- ==============================================================================

-- updated_at
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_workspaces_updated_at ON public.workspaces;
CREATE TRIGGER trg_workspaces_updated_at BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_workspace_members_updated_at ON public.workspace_members;
CREATE TRIGGER trg_workspace_members_updated_at BEFORE UPDATE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_spaces_updated_at ON public.spaces;
CREATE TRIGGER trg_spaces_updated_at BEFORE UPDATE ON public.spaces
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_folders_updated_at ON public.folders;
CREATE TRIGGER trg_folders_updated_at BEFORE UPDATE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_lists_updated_at ON public.lists;
CREATE TRIGGER trg_lists_updated_at BEFORE UPDATE ON public.lists
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_tasks_updated_at ON public.tasks;
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_subtasks_updated_at ON public.subtasks;
CREATE TRIGGER trg_subtasks_updated_at BEFORE UPDATE ON public.subtasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- identity / membership
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
DROP TRIGGER IF EXISTS trg_profiles_guard_update ON public.profiles;
CREATE TRIGGER trg_profiles_guard_update BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();
DROP TRIGGER IF EXISTS trg_on_workspace_created ON public.workspaces;
CREATE TRIGGER trg_on_workspace_created AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_workspace();
DROP TRIGGER IF EXISTS trg_workspaces_guard_update ON public.workspaces;
CREATE TRIGGER trg_workspaces_guard_update BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.guard_workspace_update();
DROP TRIGGER IF EXISTS trg_workspace_members_guard ON public.workspace_members;
CREATE TRIGGER trg_workspace_members_guard BEFORE UPDATE OR DELETE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_membership_change();

-- hierarchy integrity
DROP TRIGGER IF EXISTS trg_folders_set_workspace ON public.folders;
CREATE TRIGGER trg_folders_set_workspace BEFORE INSERT OR UPDATE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.set_folder_workspace();
DROP TRIGGER IF EXISTS trg_lists_set_workspace ON public.lists;
CREATE TRIGGER trg_lists_set_workspace BEFORE INSERT OR UPDATE ON public.lists
  FOR EACH ROW EXECUTE FUNCTION public.set_list_workspace();
DROP TRIGGER IF EXISTS trg_tasks_guard_update ON public.tasks;
CREATE TRIGGER trg_tasks_guard_update BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_task_update();
DROP TRIGGER IF EXISTS trg_tasks_set_workspace ON public.tasks;
CREATE TRIGGER trg_tasks_set_workspace BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_task_workspace();
DROP TRIGGER IF EXISTS trg_subtasks_guard_update ON public.subtasks;
CREATE TRIGGER trg_subtasks_guard_update BEFORE UPDATE ON public.subtasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_subtask_update();
DROP TRIGGER IF EXISTS trg_subtasks_set_workspace ON public.subtasks;
CREATE TRIGGER trg_subtasks_set_workspace BEFORE INSERT OR UPDATE ON public.subtasks
  FOR EACH ROW EXECUTE FUNCTION public.set_subtask_workspace();

-- ==============================================================================
-- 7. ROW LEVEL SECURITY
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;

-- 7.1 PROFILES  (no INSERT policy: only the handle_new_user trigger creates rows)
CREATE POLICY "profiles_select"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.shares_workspace_with(id));

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 7.2 WORKSPACES
-- owner_id = auth.uid() lets the creator read the row back from INSERT ... RETURNING
-- before the membership trigger row is visible to the policy.
CREATE POLICY "workspaces_select"
  ON public.workspaces FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_workspace_member(id));

CREATE POLICY "workspaces_insert"
  ON public.workspaces FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND public.is_active_user());

CREATE POLICY "workspaces_update"
  ON public.workspaces FOR UPDATE TO authenticated
  USING (public.is_workspace_admin(id))
  WITH CHECK (public.is_workspace_admin(id));

CREATE POLICY "workspaces_delete"
  ON public.workspaces FOR DELETE TO authenticated
  USING (public.is_workspace_owner(id));

-- 7.3 WORKSPACE MEMBERS
-- Admins manage members but can never create, change or remove an OWNER.
CREATE POLICY "workspace_members_select"
  ON public.workspace_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_internal_member(workspace_id));

CREATE POLICY "workspace_members_insert"
  ON public.workspace_members FOR INSERT TO authenticated
  WITH CHECK (
    public.is_workspace_owner(workspace_id)
    OR (public.is_workspace_admin(workspace_id) AND role <> 'OWNER')
  );

CREATE POLICY "workspace_members_update"
  ON public.workspace_members FOR UPDATE TO authenticated
  USING (
    public.is_workspace_owner(workspace_id)
    OR (public.is_workspace_admin(workspace_id) AND role <> 'OWNER')
  )
  WITH CHECK (
    public.is_workspace_owner(workspace_id)
    OR (public.is_workspace_admin(workspace_id) AND role <> 'OWNER')
  );

CREATE POLICY "workspace_members_delete"
  ON public.workspace_members FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_workspace_owner(workspace_id)
    OR (public.is_workspace_admin(workspace_id) AND role <> 'OWNER')
  );

-- 7.4 SPACES (OWNER/ADMIN manage)
CREATE POLICY "spaces_select"
  ON public.spaces FOR SELECT TO authenticated
  USING (public.is_internal_member(workspace_id));

CREATE POLICY "spaces_insert"
  ON public.spaces FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY "spaces_update"
  ON public.spaces FOR UPDATE TO authenticated
  USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY "spaces_delete"
  ON public.spaces FOR DELETE TO authenticated
  USING (public.is_workspace_admin(workspace_id));

-- 7.5 FOLDERS (managers create/edit, admins delete)
CREATE POLICY "folders_select"
  ON public.folders FOR SELECT TO authenticated
  USING (public.is_internal_member(workspace_id));

CREATE POLICY "folders_insert"
  ON public.folders FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_manager(workspace_id));

CREATE POLICY "folders_update"
  ON public.folders FOR UPDATE TO authenticated
  USING (public.is_workspace_manager(workspace_id))
  WITH CHECK (public.is_workspace_manager(workspace_id));

CREATE POLICY "folders_delete"
  ON public.folders FOR DELETE TO authenticated
  USING (public.is_workspace_admin(workspace_id));

-- 7.6 LISTS
CREATE POLICY "lists_select"
  ON public.lists FOR SELECT TO authenticated
  USING (public.is_internal_member(workspace_id));

CREATE POLICY "lists_insert"
  ON public.lists FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_manager(workspace_id));

CREATE POLICY "lists_update"
  ON public.lists FOR UPDATE TO authenticated
  USING (public.is_workspace_manager(workspace_id))
  WITH CHECK (public.is_workspace_manager(workspace_id));

CREATE POLICY "lists_delete"
  ON public.lists FOR DELETE TO authenticated
  USING (public.is_workspace_admin(workspace_id));

-- 7.7 TASKS (managers create/delete; QC and editors update status/position only,
--     enforced by guard_task_update)
CREATE POLICY "tasks_select"
  ON public.tasks FOR SELECT TO authenticated
  USING (public.is_internal_member(workspace_id));

CREATE POLICY "tasks_insert"
  ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_manager(workspace_id));

CREATE POLICY "tasks_update"
  ON public.tasks FOR UPDATE TO authenticated
  USING (public.is_internal_member(workspace_id))
  WITH CHECK (public.is_internal_member(workspace_id));

CREATE POLICY "tasks_delete"
  ON public.tasks FOR DELETE TO authenticated
  USING (public.is_workspace_manager(workspace_id));

-- 7.8 SUBTASKS
CREATE POLICY "subtasks_select"
  ON public.subtasks FOR SELECT TO authenticated
  USING (public.is_internal_member(workspace_id));

CREATE POLICY "subtasks_insert"
  ON public.subtasks FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_manager(workspace_id));

CREATE POLICY "subtasks_update"
  ON public.subtasks FOR UPDATE TO authenticated
  USING (public.is_internal_member(workspace_id))
  WITH CHECK (public.is_internal_member(workspace_id));

CREATE POLICY "subtasks_delete"
  ON public.subtasks FOR DELETE TO authenticated
  USING (public.is_workspace_manager(workspace_id));

-- ==============================================================================
-- 8. PRIVILEGES (defense in depth on top of RLS)
-- The app has no anonymous use case: anon gets nothing. Signed-in users keep
-- normal CRUD (RLS decides rows) but never TRUNCATE/REFERENCES/TRIGGER.
-- ==============================================================================

REVOKE ALL ON TABLE
  public.profiles, public.workspaces, public.workspace_members, public.spaces,
  public.folders, public.lists, public.tasks, public.subtasks
FROM anon;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.profiles, public.workspaces, public.workspace_members, public.spaces,
  public.folders, public.lists, public.tasks, public.subtasks
FROM authenticated;

-- Helper functions: callable by signed-in users only.
REVOKE ALL ON FUNCTION
  public.workspace_role(UUID), public.is_workspace_member(UUID),
  public.is_internal_member(UUID), public.is_workspace_manager(UUID),
  public.is_workspace_admin(UUID), public.is_workspace_owner(UUID),
  public.is_active_user(), public.shares_workspace_with(UUID)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.workspace_role(UUID), public.is_workspace_member(UUID),
  public.is_internal_member(UUID), public.is_workspace_manager(UUID),
  public.is_workspace_admin(UUID), public.is_workspace_owner(UUID),
  public.is_active_user(), public.shares_workspace_with(UUID)
TO authenticated;

-- Trigger functions are never called directly.
REVOKE ALL ON FUNCTION
  public.handle_updated_at(), public.handle_new_user(), public.guard_profile_update(),
  public.handle_new_workspace(), public.guard_workspace_update(),
  public.guard_membership_change(), public.set_folder_workspace(),
  public.set_list_workspace(), public.set_task_workspace(),
  public.set_subtask_workspace(), public.guard_task_update(),
  public.guard_subtask_update()
FROM PUBLIC, anon, authenticated;

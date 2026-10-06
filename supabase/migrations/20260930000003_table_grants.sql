-- ==============================================================================
-- Migration: 20260930000003_table_grants.sql
-- Purpose : Grant the table privileges the app actually needs.
--
-- Why this exists: on this Supabase project, tables created by a migration get NO
-- automatic privileges for the API roles (see pg_default_acl: there is no default
-- ACL for objects owned by `postgres` in schema public). Migration 1 enabled RLS
-- and wrote the policies, but without GRANTs every signed-in request fails with
-- "permission denied for table ..." before RLS is even evaluated.
--
-- Model: GRANTs say which operations a role may attempt; RLS policies and the guard
-- triggers from migration 1 decide which rows and columns. Both must allow it.
--
--   anon           : nothing. The app has no signed-out data access.
--   authenticated  : the CRUD operations the policies are written for.
--                    profiles: SELECT + UPDATE only. Profiles are created by the
--                    handle_new_user trigger and cascade-deleted with auth.users,
--                    so clients never INSERT or DELETE them.
--                    TRUNCATE / REFERENCES / TRIGGER are never granted.
--   service_role   : full access (it bypasses RLS but still needs privileges).
--
-- Convention for future migrations: grant privileges explicitly, table by table,
-- in the same migration that creates the table. Do NOT use ALTER DEFAULT PRIVILEGES
-- to auto-grant: a new table must never become reachable before its policies exist.
--
-- Rollback:
--   REVOKE ALL ON TABLE public.profiles, public.workspaces, public.workspace_members,
--     public.spaces, public.folders, public.lists, public.tasks, public.subtasks
--     FROM authenticated, service_role;
-- ==============================================================================

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

GRANT SELECT, UPDATE ON TABLE public.profiles TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.workspaces,
  public.workspace_members,
  public.spaces,
  public.folders,
  public.lists,
  public.tasks,
  public.subtasks
TO authenticated;

GRANT ALL ON TABLE
  public.profiles,
  public.workspaces,
  public.workspace_members,
  public.spaces,
  public.folders,
  public.lists,
  public.tasks,
  public.subtasks
TO service_role;

-- Re-assert: signed-out users and clients never get these.
REVOKE ALL ON TABLE
  public.profiles, public.workspaces, public.workspace_members, public.spaces,
  public.folders, public.lists, public.tasks, public.subtasks
FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.profiles, public.workspaces, public.workspace_members, public.spaces,
  public.folders, public.lists, public.tasks, public.subtasks
FROM authenticated;

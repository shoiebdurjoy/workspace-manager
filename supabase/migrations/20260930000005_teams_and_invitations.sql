-- ==============================================================================
-- Migration: 20260930000005_teams_and_invitations.sql
-- Phase 4 — Authentication + Users + Teams
--
--  1. Creative pods:   teams, team_members            (docs/TBB_DATABASE_PROPOSAL.md 2.4)
--  2. Invitations:     workspace_invitations           (access is by invitation only)
--  3. Bootstrap rule:  only the FIRST workspace can be created from the client.
--
-- WHY INVITATIONS
--   TBB is an internal system (docs/TBB_REQUIREMENTS.md 1): there is no public self-signup
--   into a workspace. Anyone can create a login, but a login alone grants access to nothing.
--   An OWNER/ADMIN invites an e-mail address with a role; when that address belongs to a
--   CONFIRMED account the membership is created automatically.
--   Matching on an unconfirmed address would let anyone claim an invitation by typing
--   somebody else's e-mail, so invitations are only claimed once auth.users.email_confirmed_at
--   is set (at sign-up if already confirmed, or when the confirmation link is used).
--
-- WHY THE BOOTSTRAP RULE
--   Migration 1 let any signed-in user create a workspace. With open sign-up that would let a
--   stranger create their own workspace. TBB is single-workspace, so after the first one
--   exists clients can no longer create more (the service role still can).
--
-- DEVIATION FROM THE PROPOSAL
--   team_members has no `role` column: the pod lead is teams.lead_id, so a role would be a
--   second, conflicting source of truth.
--
-- Grants are explicit (see migration 3). Rollback: drop the three tables, the functions in
-- `private` named below, restore the migration-1 workspaces_insert policy and the previous
-- handle_new_user body.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Helpers (private schema, never exposed through the API)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.no_workspace_exists()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.workspaces)
$$;

-- Turn every open invitation for this (confirmed) e-mail into a membership.
CREATE OR REPLACE FUNCTION private.claim_invitations(p_user_id UUID, p_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  SELECT i.workspace_id, p_user_id, i.role
  FROM public.workspace_invitations i
  WHERE i.email = lower(btrim(p_email)) AND i.accepted_at IS NULL
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  UPDATE public.workspace_invitations
  SET accepted_at = now(), accepted_by = p_user_id
  WHERE email = lower(btrim(p_email)) AND accepted_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.no_workspace_exists() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.no_workspace_exists() TO authenticated, service_role;
REVOKE ALL ON FUNCTION private.claim_invitations(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 2. Tables
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL CHECK (length(btrim(name)) > 0),
  description TEXT,
  color VARCHAR(50) NOT NULL DEFAULT '#7B68EE',
  lead_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_workspace_name ON public.teams (workspace_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_teams_workspace ON public.teams (workspace_id);

CREATE TABLE IF NOT EXISTS public.team_members (
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- derived from the team by a trigger; never trusted from the client
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON public.team_members (user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_workspace ON public.team_members (workspace_id);

CREATE TABLE IF NOT EXISTS public.workspace_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1),
  -- OWNER cannot be granted by invitation
  role VARCHAR(50) NOT NULL DEFAULT 'EDITOR' CHECK (role IN (
    'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST', 'EDITOR', 'CLIENT_VIEWER'
  )),
  invited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_open
  ON public.workspace_invitations (workspace_id, email) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invitations_workspace ON public.workspace_invitations (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invitations_email_open ON public.workspace_invitations (email) WHERE accepted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 3. Trigger functions
-- ------------------------------------------------------------------------------

-- 3.1 teams: workspace is immutable; the lead must belong to the workspace.
CREATE OR REPLACE FUNCTION public.guard_team_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'a team cannot be moved to another workspace' USING ERRCODE = '42501';
  END IF;
  IF NEW.lead_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.lead_id
  ) THEN
    RAISE EXCEPTION 'the team lead must be a member of the workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- 3.2 team_members: derive workspace from the team; the user must be a workspace member.
CREATE OR REPLACE FUNCTION public.set_team_member_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ws UUID;
BEGIN
  SELECT workspace_id INTO ws FROM public.teams WHERE id = NEW.team_id;
  IF ws IS NULL THEN
    RAISE EXCEPTION 'team % does not exist', NEW.team_id USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.team_id IS DISTINCT FROM OLD.team_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'team membership cannot be rewritten' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = ws AND m.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'only workspace members can join a team' USING ERRCODE = '23514';
  END IF;
  NEW.workspace_id := ws;
  RETURN NEW;
END;
$$;

-- 3.3 Leaving the workspace also removes the person from every team and lead position.
CREATE OR REPLACE FUNCTION public.cleanup_team_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.team_members WHERE workspace_id = OLD.workspace_id AND user_id = OLD.user_id;
  UPDATE public.teams SET lead_id = NULL WHERE workspace_id = OLD.workspace_id AND lead_id = OLD.user_id;
  RETURN OLD;
END;
$$;

-- 3.4 invitations: normalise, stamp the inviter, and accept at once when the address
--     already belongs to a confirmed account.
CREATE OR REPLACE FUNCTION public.prepare_invitation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.email := lower(btrim(NEW.email));
  IF TG_OP = 'INSERT' THEN
    -- a client can never create an already-accepted invitation or forge the inviter
    NEW.accepted_at := NULL;
    NEW.accepted_by := NULL;
    IF auth.uid() IS NOT NULL THEN
      NEW.invited_by := auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_invitation_if_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID;
BEGIN
  SELECT u.id INTO uid
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE lower(u.email) = NEW.email AND u.email_confirmed_at IS NOT NULL AND p.is_active;
  IF uid IS NOT NULL THEN
    PERFORM private.claim_invitations(uid, NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

-- 3.5 Claim invitations when an account becomes confirmed.
CREATE OR REPLACE FUNCTION private.handle_user_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    PERFORM private.claim_invitations(NEW.id, NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

-- 3.6 handle_new_user: same as before (role is ALWAYS EDITOR) plus invitation claiming for
--     accounts that are already confirmed when they are created.
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

  IF NEW.email_confirmed_at IS NOT NULL THEN
    PERFORM private.claim_invitations(NEW.id, NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION
  public.guard_team_write(), public.set_team_member_workspace(), public.cleanup_team_membership(),
  public.prepare_invitation(), public.accept_invitation_if_confirmed(), private.handle_user_confirmed(),
  public.handle_new_user()
FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 4. Triggers
-- ------------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_teams_updated_at ON public.teams;
CREATE TRIGGER trg_teams_updated_at BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_teams_guard ON public.teams;
CREATE TRIGGER trg_teams_guard BEFORE INSERT OR UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.guard_team_write();
DROP TRIGGER IF EXISTS trg_team_members_set_workspace ON public.team_members;
CREATE TRIGGER trg_team_members_set_workspace BEFORE INSERT OR UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.set_team_member_workspace();
DROP TRIGGER IF EXISTS trg_workspace_members_cleanup_teams ON public.workspace_members;
CREATE TRIGGER trg_workspace_members_cleanup_teams AFTER DELETE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_team_membership();
DROP TRIGGER IF EXISTS trg_invitations_prepare ON public.workspace_invitations;
CREATE TRIGGER trg_invitations_prepare BEFORE INSERT OR UPDATE ON public.workspace_invitations
  FOR EACH ROW EXECUTE FUNCTION public.prepare_invitation();
DROP TRIGGER IF EXISTS trg_invitations_accept ON public.workspace_invitations;
CREATE TRIGGER trg_invitations_accept AFTER INSERT ON public.workspace_invitations
  FOR EACH ROW EXECUTE FUNCTION public.accept_invitation_if_confirmed();
DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_confirmed AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION private.handle_user_confirmed();

-- ------------------------------------------------------------------------------
-- 5. Row Level Security
-- ------------------------------------------------------------------------------

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;

-- Teams: staff can read; OWNER/ADMIN manage pods.
CREATE POLICY "teams_select" ON public.teams FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id));
CREATE POLICY "teams_insert" ON public.teams FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_admin(workspace_id));
CREATE POLICY "teams_update" ON public.teams FOR UPDATE TO authenticated
  USING (private.is_workspace_admin(workspace_id))
  WITH CHECK (private.is_workspace_admin(workspace_id));
CREATE POLICY "teams_delete" ON public.teams FOR DELETE TO authenticated
  USING (private.is_workspace_admin(workspace_id));

-- Team members: staff can read; managers (pod leads included) add and remove people.
CREATE POLICY "team_members_select" ON public.team_members FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id));
CREATE POLICY "team_members_insert" ON public.team_members FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_manager(workspace_id));
CREATE POLICY "team_members_delete" ON public.team_members FOR DELETE TO authenticated
  USING (private.is_workspace_manager(workspace_id));

-- Invitations: only OWNER/ADMIN can see or manage them. No UPDATE policy: an invitation is
-- created, then either accepted by the database or revoked (deleted).
CREATE POLICY "invitations_select" ON public.workspace_invitations FOR SELECT TO authenticated
  USING (private.is_workspace_admin(workspace_id));
CREATE POLICY "invitations_insert" ON public.workspace_invitations FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_admin(workspace_id));
CREATE POLICY "invitations_delete" ON public.workspace_invitations FOR DELETE TO authenticated
  USING (private.is_workspace_admin(workspace_id));

-- First-workspace-only bootstrap (replaces the migration-1 / migration-4 policy).
DROP POLICY IF EXISTS "workspaces_insert" ON public.workspaces;
CREATE POLICY "workspaces_insert" ON public.workspaces FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND private.is_active_user()
    AND private.no_workspace_exists()
  );

-- ------------------------------------------------------------------------------
-- 6. Privileges (explicit, least privilege)
-- ------------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.teams TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.team_members TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.workspace_invitations TO authenticated;
GRANT ALL ON TABLE public.teams, public.team_members, public.workspace_invitations TO service_role;

REVOKE ALL ON TABLE public.teams, public.team_members, public.workspace_invitations FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.teams, public.team_members, public.workspace_invitations FROM authenticated;

-- ==============================================================================
-- Migration: 20260930000006_hierarchy_ordering_and_constraints.sql
-- Phase 5 — Workspace hierarchy (Spaces -> Folders -> Lists)
--
-- The tables, foreign keys, workspace derivation triggers, indexes, RLS policies and
-- grants for spaces / folders / lists already exist (migrations 1-4) and already follow
-- docs/TBB_PERMISSION_MODEL.md: spaces are Owner/Admin; folders and lists are created and
-- edited by Owner/Admin/Production Manager and deleted by Owner/Admin. They are reused as is.
-- This migration adds only what Phase 5 still needs:
--
--  1. reorder_hierarchy(): ONE atomic statement that re-sequences siblings. Doing it from the
--     browser as N separate updates could leave a half-applied order.
--     It is SECURITY INVOKER: every row is still checked by the caller's own RLS policies, so
--     it grants nothing a client could not already do with plain UPDATEs.
--  2. Validation of the free-text presentation columns (colors and icon names), so a
--     malformed value can never be stored and later rendered into a style attribute.
--
-- Existing rows already satisfy the new CHECK constraints (defaults are '#7B68EE' / 'folder').
-- Rollback:
--   DROP FUNCTION public.reorder_hierarchy(TEXT, UUID[]);
--   ALTER TABLE public.spaces DROP CONSTRAINT spaces_color_hex, DROP CONSTRAINT spaces_icon_slug;
--   ALTER TABLE public.lists  DROP CONSTRAINT lists_color_hex;
--   ALTER TABLE public.teams  DROP CONSTRAINT teams_color_hex;
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Presentation constraints
-- ------------------------------------------------------------------------------

ALTER TABLE public.spaces
  ADD CONSTRAINT spaces_color_hex CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT spaces_icon_slug CHECK (icon ~ '^[a-z0-9-]{1,50}$');

ALTER TABLE public.lists
  ADD CONSTRAINT lists_color_hex CHECK (color ~ '^#[0-9A-Fa-f]{6}$');

ALTER TABLE public.teams
  ADD CONSTRAINT teams_color_hex CHECK (color ~ '^#[0-9A-Fa-f]{6}$');

-- ------------------------------------------------------------------------------
-- 2. Atomic sibling reordering
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reorder_hierarchy(kind TEXT, ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  expected INTEGER;
  updated INTEGER;
BEGIN
  IF ids IS NULL OR cardinality(ids) = 0 THEN
    RETURN 0;
  END IF;

  SELECT count(DISTINCT x) INTO expected FROM unnest(ids) AS x;
  IF expected <> cardinality(ids) THEN
    RAISE EXCEPTION 'reorder_hierarchy: duplicate ids' USING ERRCODE = '22023';
  END IF;

  -- position = index in the supplied order; one statement, so all-or-nothing
  IF kind = 'space' THEN
    UPDATE public.spaces s SET position = o.idx - 1
    FROM unnest(ids) WITH ORDINALITY AS o(id, idx) WHERE s.id = o.id;
  ELSIF kind = 'folder' THEN
    UPDATE public.folders f SET position = o.idx - 1
    FROM unnest(ids) WITH ORDINALITY AS o(id, idx) WHERE f.id = o.id;
  ELSIF kind = 'list' THEN
    UPDATE public.lists l SET position = o.idx - 1
    FROM unnest(ids) WITH ORDINALITY AS o(id, idx) WHERE l.id = o.id;
  ELSE
    RAISE EXCEPTION 'reorder_hierarchy: kind must be space, folder or list' USING ERRCODE = '22023';
  END IF;

  GET DIAGNOSTICS updated = ROW_COUNT;

  -- RLS silently skips rows the caller may not update. Refuse partial results.
  IF updated <> cardinality(ids) THEN
    RAISE EXCEPTION 'you do not have permission to reorder these items' USING ERRCODE = '42501';
  END IF;

  RETURN updated;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_hierarchy(TEXT, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_hierarchy(TEXT, UUID[]) TO authenticated;

-- ==============================================================================
-- Migration: 20260930000002_not_null_defaults.sql
-- Purpose : Make four defaulted columns NOT NULL so the database matches the
--           application types (Row types declare them as non-null strings).
--
--   lists.color        DEFAULT '#7B68EE'
--   spaces.color       DEFAULT '#7B68EE'
--   spaces.icon        DEFAULT 'folder'
--   profiles.timezone  DEFAULT 'UTC'
--
-- Existing defaults are kept as they are (SET NOT NULL does not touch them).
--
-- Safety: the backfill UPDATEs below make this safe on a database that already
-- has rows (NULLs are replaced by the column default first). On an empty
-- database they affect 0 rows. Application code that omits these columns keeps
-- working because the defaults still apply; only an explicit NULL is now rejected.
--
-- Rollback (if ever needed):
--   ALTER TABLE public.lists    ALTER COLUMN color    DROP NOT NULL;
--   ALTER TABLE public.spaces   ALTER COLUMN color    DROP NOT NULL;
--   ALTER TABLE public.spaces   ALTER COLUMN icon     DROP NOT NULL;
--   ALTER TABLE public.profiles ALTER COLUMN timezone DROP NOT NULL;
-- ==============================================================================

UPDATE public.lists    SET color    = '#7B68EE' WHERE color    IS NULL;
UPDATE public.spaces   SET color    = '#7B68EE' WHERE color    IS NULL;
UPDATE public.spaces   SET icon     = 'folder'  WHERE icon     IS NULL;
UPDATE public.profiles SET timezone = 'UTC'     WHERE timezone IS NULL;

ALTER TABLE public.lists    ALTER COLUMN color    SET NOT NULL;
ALTER TABLE public.spaces   ALTER COLUMN color    SET NOT NULL;
ALTER TABLE public.spaces   ALTER COLUMN icon     SET NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN timezone SET NOT NULL;

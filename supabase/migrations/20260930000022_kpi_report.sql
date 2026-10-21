-- ==============================================================================
-- Migration 22: KPI report (Phase 14)
-- ==============================================================================
-- One read function for the Reports page. Like the production analytics it is built on first-QC
-- submissions (a video counts once, when it first reached QC), is SECURITY INVOKER, and so is limited by
-- the credits table's own RLS to Owner / Admin; everyone else gets nothing.
--
--   kpi_report(workspace, weeks, timezone) returns JSONB:
--     weekly:      one entry per week (oldest first, zero-filled): { weekStart, videos }
--     turnaround:  { videos, avgHours, medianHours }  hours from task creation to its first QC submission
--     clients:     per list (the client's pipeline), top 12 by videos: { listId, name, videos, avgRevisions, avgHours }
--     totals:      { videos, avgRevisions }
--   Window: the last `weeks` weeks (1-52), weeks starting Monday in `timezone`.
--
-- Rollback: DROP FUNCTION public.kpi_report(UUID, INT, TEXT);
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.kpi_report(p_workspace_id UUID, p_weeks INT DEFAULT 12, p_timezone TEXT DEFAULT 'UTC')
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  weeks INT := LEAST(GREATEST(COALESCE(p_weeks, 12), 1), 52);
  tz TEXT := COALESCE(NULLIF(p_timezone, ''), 'UTC');
  first_week TIMESTAMP;
  result JSONB;
BEGIN
  IF NOT private.is_internal_member(p_workspace_id) THEN
    RAISE EXCEPTION 'you do not have access to this workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = tz) THEN
    RAISE EXCEPTION 'unknown time zone' USING ERRCODE = '22023';
  END IF;
  first_week := date_trunc('week', (NOW() AT TIME ZONE tz)) - make_interval(weeks => weeks - 1);

  WITH c AS MATERIALIZED (
    SELECT cr.task_id, (cr.first_qc_submitted_at AT TIME ZONE tz) AS at_local,
           EXTRACT(EPOCH FROM (cr.first_qc_submitted_at - t.created_at)) / 3600.0 AS hours,
           t.revision_count, t.list_id
    FROM public.task_production_credits cr
    JOIN public.tasks t ON t.id = cr.task_id
    WHERE cr.workspace_id = p_workspace_id AND (cr.first_qc_submitted_at AT TIME ZONE tz) >= first_week
  ),
  wk AS (
    SELECT gs::date AS week_start, count(c.task_id)::int AS videos
    FROM generate_series(first_week, first_week + make_interval(weeks => weeks - 1), interval '1 week') gs
    LEFT JOIN c ON date_trunc('week', c.at_local) = gs
    GROUP BY gs
  ),
  cl AS (
    SELECT l.id AS list_id, l.name, count(*)::int AS videos,
           round(avg(c.revision_count)::numeric, 2) AS avg_rev, round(avg(c.hours)::numeric, 1) AS avg_hours
    FROM c JOIN public.lists l ON l.id = c.list_id
    GROUP BY l.id, l.name ORDER BY count(*) DESC, l.name LIMIT 12
  )
  SELECT jsonb_build_object(
    'weekly', COALESCE((SELECT jsonb_agg(jsonb_build_object('weekStart', week_start, 'videos', videos) ORDER BY week_start) FROM wk), '[]'::jsonb),
    'turnaround', jsonb_build_object(
      'videos', (SELECT count(*) FROM c),
      'avgHours', (SELECT round(avg(hours)::numeric, 1) FROM c),
      'medianHours', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours))::numeric, 1) FROM c)),
    'clients', COALESCE((SELECT jsonb_agg(jsonb_build_object('listId', list_id, 'name', name, 'videos', videos, 'avgRevisions', avg_rev, 'avgHours', avg_hours)) FROM cl), '[]'::jsonb),
    'totals', jsonb_build_object('videos', (SELECT count(*) FROM c), 'avgRevisions', (SELECT round(avg(revision_count)::numeric, 2) FROM c))
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.kpi_report(UUID, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kpi_report(UUID, INT, TEXT) TO authenticated;

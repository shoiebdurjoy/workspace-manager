-- ==============================================================================
-- Migration 11: database-side task search, filters and sorting (Phase 9)
-- ==============================================================================
-- One read function, search_tasks(), answers every task view (a list, a folder, a space or the whole
-- workspace): free-text search, multi-criteria filters, sorting and paging all happen in Postgres, so
-- the browser never downloads every task just to search it.
--
--   * SECURITY INVOKER: every table it reads (tasks, lists, folders, spaces, task_assignees, profiles,
--     subtasks) is read under the CALLER's RLS. Search can never reveal a row the person could not
--     read with a plain SELECT; RLS stays the security boundary. It also refuses non-members outright.
--   * Dynamic SQL, but only the clauses that are in use, and every value is bound as a typed literal
--     (format %L on uuid[] / text[] / timestamptz), the sort is a whitelist: no string from the client
--     is ever spliced into the statement.
--   * Free text matches, per word (all words must match, each in at least one place): the task title
--     and brief (trigram-indexed), its short id (a range on the primary key), and the names of its
--     list, folder, space, editor and QC reviewer. Those names are resolved first against the small
--     tables they live in, so every alternative is a condition on tasks itself and indexable.
--   * pg_trgm GIN indexes make "%word%" on title and description index-assisted.
--
-- Rollback:
--   DROP FUNCTION public.search_tasks(UUID, TEXT, JSONB, TEXT, TEXT, INT, INT);
--   DROP FUNCTION private.json_uuids(JSONB), private.json_texts(JSONB);
--   DROP INDEX public.idx_tasks_title_trgm, public.idx_tasks_description_trgm;
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Trigram indexes (the operator class lives in whichever schema holds the extension)
DO $$
DECLARE
  ext_schema TEXT;
BEGIN
  SELECT n.nspname INTO ext_schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tasks_title_trgm ON public.tasks USING gin (title %I.gin_trgm_ops)', ext_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tasks_description_trgm ON public.tasks USING gin (description %I.gin_trgm_ops)', ext_schema);
END
$$;

-- ------------------------------------------------------------------------------
-- Small, strict JSON readers for the filter object (bounded, typed)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.json_texts(j JSONB)
RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF j IS NULL OR jsonb_typeof(j) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(j) <> 'array' THEN
    RAISE EXCEPTION 'a filter must be a list' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(j) = 0 THEN
    RETURN NULL; -- an empty list means "no filter"
  END IF;
  IF jsonb_array_length(j) > 100 THEN
    -- never silently ignore a filter: that would widen the result
    RAISE EXCEPTION 'too many values in one filter (100 at most)' USING ERRCODE = '22023';
  END IF;
  RETURN ARRAY(SELECT left(v, 200) FROM jsonb_array_elements_text(j) AS v);
END;
$$;

CREATE OR REPLACE FUNCTION private.json_uuids(j JSONB)
RETURNS UUID[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  t TEXT[] := private.json_texts(j);
BEGIN
  IF t IS NULL THEN
    RETURN NULL; -- no filter
  END IF;
  RETURN ARRAY(SELECT v::uuid FROM unnest(t) AS v);
END;
$$;

REVOKE ALL ON FUNCTION private.json_texts(JSONB), private.json_uuids(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.json_texts(JSONB), private.json_uuids(JSONB) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- search_tasks
-- ------------------------------------------------------------------------------
-- p_filters (all optional, all combined with AND):
--   spaces, folders, lists            uuid[]   where the task lives
--   statuses, priorities, aspectRatios text[]
--   editors, qcs                       uuid[]   with noEditor / noQc: true to include "nobody"
--   people                             uuid[]   editor OR QC reviewer ("assigned to me")
--   dueFrom, dueTo, noDue              internal QC due date range / none
--   clientFrom, clientTo, noClient     client deadline range / none
--   createdFrom, createdTo             creation time range
--   overdue                            unfinished and a deadline before overdueBefore (default now())
--   overdueBefore                      the start of the viewer's today (their time zone)
--   hideFinished                       leave out stages of category COMPLETED
-- p_sort: manual | dueDate | clientDeadline | priority | status | editor | qc | title | created | updated
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.search_tasks(
  p_workspace_id UUID,
  p_query TEXT DEFAULT NULL,
  p_filters JSONB DEFAULT '{}'::jsonb,
  p_sort TEXT DEFAULT 'manual',
  p_dir TEXT DEFAULT 'asc',
  p_limit INT DEFAULT 500,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id public.tasks.id%TYPE,
  list_id public.tasks.list_id%TYPE,
  title public.tasks.title%TYPE,
  status public.tasks.status%TYPE,
  priority public.tasks.priority%TYPE,
  "position" public.tasks.position%TYPE,
  aspect_ratio public.tasks.aspect_ratio%TYPE,
  due_date public.tasks.due_date%TYPE,
  client_deadline public.tasks.client_deadline%TYPE,
  revision_count public.tasks.revision_count%TYPE,
  raw_footage_link public.tasks.raw_footage_link%TYPE,
  project_file_link public.tasks.project_file_link%TYPE,
  review_link public.tasks.review_link%TYPE,
  final_export_link public.tasks.final_export_link%TYPE,
  created_at public.tasks.created_at%TYPE,
  updated_at public.tasks.updated_at%TYPE,
  editor_id UUID,
  qc_id UUID,
  subtask_total INT,
  subtask_done INT,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  f JSONB := COALESCE(p_filters, '{}'::jsonb);
  wf UUID;
  clauses TEXT[] := ARRAY[format('t.workspace_id = %L::uuid', p_workspace_id)];
  words TEXT[];
  word TEXT;
  pat TEXT;
  hex TEXT;
  lists_hit UUID[];
  tasks_hit UUID[];
  a_uuid UUID[];
  a_text TEXT[];
  part TEXT[];
  dir TEXT;
  lim INT;
  off INT;
  order_by TEXT;
  sql TEXT;
  ts TIMESTAMPTZ;
BEGIN
  IF NOT private.is_internal_member(p_workspace_id) THEN
    RAISE EXCEPTION 'you do not have access to this workspace''s tasks' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(f) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'filters must be an object' USING ERRCODE = '22023';
  END IF;

  dir := CASE lower(COALESCE(p_dir, 'asc')) WHEN 'desc' THEN 'DESC' ELSE 'ASC' END;
  lim := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
  off := GREATEST(COALESCE(p_offset, 0), 0);
  wf := private.task_workflow_id(p_workspace_id);

  -- ---- where it lives -------------------------------------------------------------------
  a_uuid := private.json_uuids(f -> 'spaces');
  IF a_uuid IS NOT NULL THEN clauses := clauses || format('s.id = ANY(%L::uuid[])', a_uuid); END IF;
  a_uuid := private.json_uuids(f -> 'folders');
  IF a_uuid IS NOT NULL THEN clauses := clauses || format('l.folder_id = ANY(%L::uuid[])', a_uuid); END IF;
  a_uuid := private.json_uuids(f -> 'lists');
  IF a_uuid IS NOT NULL THEN clauses := clauses || format('t.list_id = ANY(%L::uuid[])', a_uuid); END IF;

  -- ---- plain properties -----------------------------------------------------------------
  a_text := private.json_texts(f -> 'statuses');
  IF a_text IS NOT NULL THEN clauses := clauses || format('t.status = ANY(%L::text[])', a_text); END IF;
  a_text := private.json_texts(f -> 'priorities');
  IF a_text IS NOT NULL THEN clauses := clauses || format('t.priority = ANY(%L::text[])', a_text); END IF;
  a_text := private.json_texts(f -> 'aspectRatios');
  IF a_text IS NOT NULL THEN clauses := clauses || format('t.aspect_ratio = ANY(%L::text[])', a_text); END IF;

  -- ---- people ---------------------------------------------------------------------------
  a_uuid := private.json_uuids(f -> 'editors');
  IF a_uuid IS NOT NULL OR COALESCE((f ->> 'noEditor')::boolean, false) THEN
    part := ARRAY[]::TEXT[];
    IF a_uuid IS NOT NULL THEN part := part || format('ed.user_id = ANY(%L::uuid[])', a_uuid); END IF;
    IF COALESCE((f ->> 'noEditor')::boolean, false) THEN part := part || 'ed.user_id IS NULL'::text; END IF;
    clauses := clauses || ('(' || array_to_string(part, ' OR ') || ')');
  END IF;
  a_uuid := private.json_uuids(f -> 'qcs');
  IF a_uuid IS NOT NULL OR COALESCE((f ->> 'noQc')::boolean, false) THEN
    part := ARRAY[]::TEXT[];
    IF a_uuid IS NOT NULL THEN part := part || format('qc.user_id = ANY(%L::uuid[])', a_uuid); END IF;
    IF COALESCE((f ->> 'noQc')::boolean, false) THEN part := part || 'qc.user_id IS NULL'::text; END IF;
    clauses := clauses || ('(' || array_to_string(part, ' OR ') || ')');
  END IF;
  a_uuid := private.json_uuids(f -> 'people');
  IF a_uuid IS NOT NULL THEN
    clauses := clauses || format('(ed.user_id = ANY(%1$L::uuid[]) OR qc.user_id = ANY(%1$L::uuid[]))', a_uuid);
  END IF;

  -- ---- dates ----------------------------------------------------------------------------
  IF f ? 'dueFrom' THEN clauses := clauses || format('t.due_date >= %L::timestamptz', (f ->> 'dueFrom')::timestamptz); END IF;
  IF f ? 'dueTo' THEN clauses := clauses || format('t.due_date <= %L::timestamptz', (f ->> 'dueTo')::timestamptz); END IF;
  IF COALESCE((f ->> 'noDue')::boolean, false) THEN clauses := clauses || 't.due_date IS NULL'::text; END IF;
  IF f ? 'clientFrom' THEN clauses := clauses || format('t.client_deadline >= %L::timestamptz', (f ->> 'clientFrom')::timestamptz); END IF;
  IF f ? 'clientTo' THEN clauses := clauses || format('t.client_deadline <= %L::timestamptz', (f ->> 'clientTo')::timestamptz); END IF;
  IF COALESCE((f ->> 'noClient')::boolean, false) THEN clauses := clauses || 't.client_deadline IS NULL'::text; END IF;
  IF f ? 'createdFrom' THEN clauses := clauses || format('t.created_at >= %L::timestamptz', (f ->> 'createdFrom')::timestamptz); END IF;
  IF f ? 'createdTo' THEN clauses := clauses || format('t.created_at <= %L::timestamptz', (f ->> 'createdTo')::timestamptz); END IF;

  IF COALESCE((f ->> 'overdue')::boolean, false) THEN
    ts := COALESCE((f ->> 'overdueBefore')::timestamptz, now());
    clauses := clauses || format(
      '(t.due_date < %1$L::timestamptz OR t.client_deadline < %1$L::timestamptz) AND COALESCE(wst.category, '''') <> ''COMPLETED''', ts);
  END IF;
  IF COALESCE((f ->> 'hideFinished')::boolean, false) THEN
    clauses := clauses || 'COALESCE(wst.category, '''') <> ''COMPLETED'''::text;
  END IF;

  -- ---- free text: every word must match somewhere ------------------------------------------
  IF p_query IS NOT NULL AND btrim(p_query) <> '' THEN
    words := (SELECT array_agg(w) FROM (
      SELECT left(w, 100) AS w FROM unnest(regexp_split_to_array(btrim(p_query), '\s+')) AS w LIMIT 8
    ) x);
    FOREACH word IN ARRAY words LOOP
      -- escape LIKE wildcards so "50%" or "a_b" search for what was typed
      pat := '%' || replace(replace(replace(word, '\', '\\'), '%', '\%'), '_', '\_') || '%';

      -- Names live in small tables (lists, folders, spaces, people): resolve them to ids first, so
      -- every alternative below is a condition on tasks itself and an index can serve it.
      lists_hit := ARRAY(
        SELECT l.id FROM public.lists l
        JOIN public.spaces s ON s.id = l.space_id
        LEFT JOIN public.folders f ON f.id = l.folder_id
        WHERE l.workspace_id = p_workspace_id AND (l.name ILIKE pat OR s.name ILIKE pat OR f.name ILIKE pat));
      tasks_hit := ARRAY(
        SELECT a.task_id FROM public.task_assignees a
        JOIN public.profiles p ON p.id = a.user_id
        WHERE a.workspace_id = p_workspace_id AND p.full_name ILIKE pat);

      part := ARRAY[format('t.title ILIKE %L', pat), format('t.description ILIKE %L', pat)];
      IF cardinality(lists_hit) > 0 THEN part := part || format('t.list_id = ANY(%L::uuid[])', lists_hit); END IF;
      IF cardinality(tasks_hit) > 0 THEN part := part || format('t.id = ANY(%L::uuid[])', tasks_hit); END IF;
      -- a short id (the first hex digits of the task id), with or without a leading #: a range on the key
      IF word ~* '^#?[0-9a-f]{4,32}$' THEN
        hex := lower(regexp_replace(word, '^#', ''));
        part := part || format('(t.id >= %L::uuid AND t.id <= %L::uuid)',
          regexp_replace(rpad(hex, 32, '0'), '^(.{8})(.{4})(.{4})(.{4})(.{12})$', '\1-\2-\3-\4-\5'),
          regexp_replace(rpad(hex, 32, 'f'), '^(.{8})(.{4})(.{4})(.{4})(.{12})$', '\1-\2-\3-\4-\5'));
      END IF;
      clauses := clauses || ('(' || array_to_string(part, ' OR ') || ')');
    END LOOP;
  END IF;

  -- ---- sort (whitelist; ties keep a stable, repeatable order) -----------------------------
  order_by := CASE p_sort
    WHEN 'dueDate' THEN format('t.due_date %s NULLS LAST', dir)
    WHEN 'clientDeadline' THEN format('t.client_deadline %s NULLS LAST', dir)
    WHEN 'priority' THEN format('CASE t.priority WHEN ''URGENT'' THEN 0 WHEN ''HIGH'' THEN 1 WHEN ''MEDIUM'' THEN 2 ELSE 3 END %s', dir)
    WHEN 'status' THEN format('COALESCE(wst.position, 2147483647) %s', dir)
    WHEN 'editor' THEN format('pe.full_name %s NULLS LAST', dir)
    WHEN 'qc' THEN format('pq.full_name %s NULLS LAST', dir)
    WHEN 'title' THEN format('lower(t.title) %s', dir)
    WHEN 'created' THEN format('t.created_at %s', dir)
    WHEN 'updated' THEN format('t.updated_at %s', dir)
    ELSE format('s.position %1$s, COALESCE(f.position, 2147483647) %1$s, l.position %1$s, t.position %1$s', dir)
  END || ', t.created_at ASC, t.id ASC';

  sql := format($q$
    SELECT t.id, t.list_id, t.title, t.status, t.priority, t.position, t.aspect_ratio, t.due_date, t.client_deadline,
           t.revision_count, t.raw_footage_link, t.project_file_link, t.review_link, t.final_export_link,
           t.created_at, t.updated_at, ed.user_id, qc.user_id, sc.total, sc.done, count(*) OVER ()
    FROM public.tasks t
    JOIN public.lists l ON l.id = t.list_id
    JOIN public.spaces s ON s.id = l.space_id
    LEFT JOIN public.folders f ON f.id = l.folder_id
    LEFT JOIN public.workflow_statuses wst ON wst.workflow_id = %L::uuid AND wst.key = t.status
    LEFT JOIN public.task_assignees ed ON ed.task_id = t.id AND ed.role_type = 'EDITOR'
    LEFT JOIN public.task_assignees qc ON qc.task_id = t.id AND qc.role_type = 'QC_REVIEWER'
    LEFT JOIN public.profiles pe ON pe.id = ed.user_id
    LEFT JOIN public.profiles pq ON pq.id = qc.user_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total, (count(*) FILTER (WHERE st.is_completed))::int AS done
      FROM public.subtasks st WHERE st.task_id = t.id
    ) sc ON true
    WHERE %s
    ORDER BY %s
    LIMIT %s OFFSET %s$q$, wf, array_to_string(clauses, ' AND '), order_by, lim, off);

  RETURN QUERY EXECUTE sql;
END;
$$;

REVOKE ALL ON FUNCTION public.search_tasks(UUID, TEXT, JSONB, TEXT, TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_tasks(UUID, TEXT, JSONB, TEXT, TEXT, INT, INT) TO authenticated;

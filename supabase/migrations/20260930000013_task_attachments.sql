-- ==============================================================================
-- Migration 13: private task attachments (Phase 10)
-- ==============================================================================
-- Small working files that belong to a task (scripts, audio stems, reference images, PDFs). The heavy
-- video stays in Drive / Frame.io, as the architecture says: this is for files under 25 MB.
--
--   * Storage: one PRIVATE bucket, `task-attachments`. There is no public URL, ever; a file is opened
--     through a short-lived signed URL that Storage only creates for a person this database says may read it.
--   * Path: <workspace-id>/<task-id>/<attachment-id>/<file>. The path says where the file belongs, and the
--     storage policies read it, so a person can only put a file where they may attach one.
--   * Who may attach: Owner / Admin / Production Manager / QC on any task, an Editor on the tasks assigned to
--     them. Who may delete: whoever uploaded it, and any manager. Everyone on the staff can read.
--   * The row in task_attachments is the metadata (name, type, size, uploader, time). It cannot exist without
--     the real stored object: size and type are READ BACK from what Storage actually stored, never taken
--     from the client, and are checked against the allowed list and the size limit again here. (The bucket
--     enforces the same limits at upload time.)
--   * A stored object nobody has a row for cannot be opened by anyone but the person who uploaded it and the
--     managers, so an abandoned upload is not a leak.
--
-- Rollback (loses every attachment record; delete the files from the bucket separately):
--   DROP TABLE public.task_attachments; DROP FUNCTION public.guard_task_attachment();
--   DROP POLICY "task_attachments_read" ON storage.objects; (and _upload, _delete)
--   DROP FUNCTION private.can_attach(TEXT), private.can_attach_to_task(UUID, UUID),
--     private.attachment_workspace(TEXT), private.attachment_task(TEXT);
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. The bucket (private, size- and type-limited)
-- ------------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-attachments',
  'task-attachments',
  false,
  26214400,
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'text/csv', 'text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/mp4', 'audio/ogg', 'audio/flac',
    'application/zip'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ------------------------------------------------------------------------------
-- 2. Reading a storage path, and the permission to attach
-- ------------------------------------------------------------------------------

-- <workspace>/<task>/<attachment>/<file>, all three ids lower-case UUIDs, a plain file name.
CREATE OR REPLACE FUNCTION private.attachment_workspace(name TEXT)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT (regexp_match(name, '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,180}$'))[1]::uuid
$$;

CREATE OR REPLACE FUNCTION private.attachment_task(name TEXT)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT (regexp_match(name, '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,180}$'))[1]::uuid
$$;

-- May the signed-in person attach files to this task?
CREATE OR REPLACE FUNCTION private.can_attach_to_task(p_task UUID, p_workspace UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT t.workspace_id = p_workspace AND (
      private.is_workspace_manager(p_workspace)
      OR private.workspace_role(p_workspace) = 'QC_SPECIALIST'
      OR (
        private.workspace_role(p_workspace) = 'EDITOR'
        AND EXISTS (
          SELECT 1 FROM public.task_assignees a
          WHERE a.task_id = t.id AND a.role_type = 'EDITOR' AND a.user_id = auth.uid()
        )
      )
    )
    FROM public.tasks t WHERE t.id = p_task
  ), false)
$$;

CREATE OR REPLACE FUNCTION private.can_attach(name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.attachment_task(name) IS NOT NULL
     AND private.can_attach_to_task(private.attachment_task(name), private.attachment_workspace(name))
$$;

REVOKE ALL ON FUNCTION private.attachment_workspace(TEXT), private.attachment_task(TEXT),
  private.can_attach_to_task(UUID, UUID), private.can_attach(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.attachment_workspace(TEXT), private.attachment_task(TEXT),
  private.can_attach_to_task(UUID, UUID), private.can_attach(TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. The metadata table
-- ------------------------------------------------------------------------------

CREATE TABLE public.task_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- what people see: the file's own name (no slashes, no control characters)
  file_name TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 180 AND file_name !~ '[[:cntrl:]/\\]'),
  storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN (
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'text/csv', 'text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/mp4', 'audio/ogg', 'audio/flac',
    'application/zip'
  )),
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_attachments_task ON public.task_attachments(task_id, created_at, id);
CREATE INDEX idx_task_attachments_workspace ON public.task_attachments(workspace_id);

-- The row can only describe an object that really exists, at the path its own ids imply, and its
-- size and type are what Storage recorded.
CREATE OR REPLACE FUNCTION public.guard_task_attachment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ws UUID;
  stored RECORD;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- The one change that is allowed: the uploader's account was deleted and the foreign key
    -- (ON DELETE SET NULL) blanks the uploader. The profile is already gone when that runs.
    IF NEW.uploaded_by IS NULL AND OLD.uploaded_by IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.uploaded_by)
       AND (NEW.id, NEW.task_id, NEW.workspace_id, NEW.file_name, NEW.storage_path, NEW.mime_type, NEW.size_bytes, NEW.created_at)
           IS NOT DISTINCT FROM (OLD.id, OLD.task_id, OLD.workspace_id, OLD.file_name, OLD.storage_path, OLD.mime_type, OLD.size_bytes, OLD.created_at) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'an attachment cannot be changed' USING ERRCODE = '42501';
  END IF;

  SELECT t.workspace_id INTO ws FROM public.tasks t WHERE t.id = NEW.task_id;
  IF ws IS NULL THEN
    RAISE EXCEPTION 'task % does not exist', NEW.task_id USING ERRCODE = '23503';
  END IF;
  NEW.workspace_id := ws;
  IF auth.uid() IS NOT NULL THEN
    NEW.uploaded_by := auth.uid();
  END IF;
  NEW.created_at := NOW();

  IF private.attachment_workspace(NEW.storage_path) IS DISTINCT FROM ws
     OR private.attachment_task(NEW.storage_path) IS DISTINCT FROM NEW.task_id
     OR split_part(NEW.storage_path, '/', 3) <> NEW.id::text THEN
    RAISE EXCEPTION 'the file is not stored where this task''s attachments belong' USING ERRCODE = '23514';
  END IF;

  SELECT o.metadata INTO stored FROM storage.objects o WHERE o.bucket_id = 'task-attachments' AND o.name = NEW.storage_path;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the file was not uploaded' USING ERRCODE = '23503';
  END IF;
  -- trust what Storage recorded, not what the client says
  NEW.size_bytes := COALESCE((stored.metadata ->> 'size')::bigint, NEW.size_bytes);
  NEW.mime_type := COALESCE(NULLIF(stored.metadata ->> 'mimetype', ''), NEW.mime_type);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_task_attachment() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_task_attachments_guard BEFORE INSERT OR UPDATE ON public.task_attachments
  FOR EACH ROW EXECUTE FUNCTION public.guard_task_attachment();

ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_attachments_select" ON public.task_attachments FOR SELECT TO authenticated
  USING (private.is_internal_member(workspace_id));

CREATE POLICY "task_attachments_insert" ON public.task_attachments FOR INSERT TO authenticated
  WITH CHECK (private.can_attach_to_task(task_id, workspace_id) AND uploaded_by = (SELECT auth.uid()));

CREATE POLICY "task_attachments_delete" ON public.task_attachments FOR DELETE TO authenticated
  USING (private.is_internal_member(workspace_id) AND (uploaded_by = (SELECT auth.uid()) OR private.is_workspace_manager(workspace_id)));

GRANT SELECT, INSERT, DELETE ON TABLE public.task_attachments TO authenticated;
GRANT ALL ON TABLE public.task_attachments TO service_role;
REVOKE ALL ON TABLE public.task_attachments FROM anon;
REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.task_attachments FROM authenticated;

-- ------------------------------------------------------------------------------
-- 4. Storage policies (objects in the bucket)
-- ------------------------------------------------------------------------------

-- Read: the staff, for a file that has a record; and the uploader / managers for any file they put there
-- (Storage needs a person to see their own new object to finish an upload or a delete).
CREATE POLICY "task_attachments_read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'task-attachments'
    AND (
      EXISTS (
        SELECT 1 FROM public.task_attachments a
        WHERE a.storage_path = name AND private.is_internal_member(a.workspace_id)
      )
      OR owner_id = (SELECT auth.uid())::text
      OR private.is_workspace_manager(private.attachment_workspace(name))
    )
  );

-- Upload: only to a path inside a task the person may attach to. No overwrite (there is no UPDATE policy).
CREATE POLICY "task_attachments_upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'task-attachments' AND private.can_attach(name));

-- Delete: the uploader, or a manager of that workspace.
CREATE POLICY "task_attachments_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'task-attachments'
    AND (owner_id = (SELECT auth.uid())::text OR private.is_workspace_manager(private.attachment_workspace(name)))
  );

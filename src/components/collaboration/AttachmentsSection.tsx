import React, { useMemo, useRef, useState } from 'react';
import { Download, ExternalLink, File as FileIcon, FileAudio, FileImage, FileText, Loader2, Paperclip, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ErrorState } from '@/components/ui/error-state';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/hooks/use-auth';
import { useAttachments, useAttachmentUploads, useDeleteAttachment, useOpenAttachment } from '@/hooks/use-collaboration';
import { useWorkspaceMembers } from '@/hooks/use-team';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  attachmentKind,
  canAttachFiles,
  canDeleteAttachment,
  formatBytes,
  isImageType,
  timeAgo,
} from '@/lib/collaboration';
import { memberLookup, memberName } from '@/lib/tasks';
import type { TaskAttachment } from '@/types/database';
import { cn } from '@/lib/utils';

function FileTypeIcon({ mime }: { mime: string }) {
  const cls = 'h-5 w-5 text-muted-foreground';
  if (isImageType(mime)) return <FileImage aria-hidden className={cls} />;
  if (mime.startsWith('audio/')) return <FileAudio aria-hidden className={cls} />;
  if (mime === 'application/pdf' || mime.startsWith('text/') || mime.includes('document') || mime.includes('presentation') || mime.includes('sheet')) {
    return <FileText aria-hidden className={cls} />;
  }
  return <FileIcon aria-hidden className={cls} />;
}

interface AttachmentsSectionProps {
  taskId: string;
  /** Is the signed-in person the task's assigned editor (editors may only attach to their own tasks). */
  isAssignedEditor: boolean;
}

/**
 * Files on a task. They live in a private bucket: opening one asks for a link that works for a minute and is
 * only made for people the database lets read it. Size and type are checked here for a readable message,
 * by the bucket when the bytes arrive, and by the database before the file gets a record.
 */
const AttachmentsSection: React.FC<AttachmentsSectionProps> = ({ taskId, isAssignedEditor }) => {
  const { user, role } = useAuth();
  const files = useAttachments(taskId);
  const { data: members = [] } = useWorkspaceMembers();
  const lookup = useMemo(() => memberLookup(members), [members]);
  const { uploads, start, cancel, dismiss } = useAttachmentUploads(taskId);
  const remove = useDeleteAttachment(taskId);
  const open = useOpenAttachment();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<TaskAttachment | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const allowed = canAttachFiles(role, isAssignedEditor);

  const pick = (list: FileList | null) => {
    if (list?.length) start(Array.from(list));
    if (input.current) input.current.value = '';
  };

  const act = async (a: TaskAttachment, mode: 'open' | 'download') => {
    setBusyId(`${a.id}:${mode}`);
    try {
      await open(a, mode);
    } finally {
      setBusyId(null);
    }
  };

  if (files.isLoading) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading files">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (files.isError) {
    return <ErrorState title="Files could not be loaded" message={files.error instanceof Error ? files.error.message : 'Please try again.'} onRetry={() => void files.refetch()} />;
  }
  const items = files.data ?? [];

  return (
    <div className="space-y-3">
      {allowed ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files);
          }}
          className={cn(
            'flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-4 text-center transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-border/80'
          )}
        >
          <Paperclip aria-hidden className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Drop files here, or{' '}
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => input.current?.click()}>
              choose files
            </Button>
          </p>
          <p className="text-[11px] text-muted-foreground">
            Up to {formatBytes(ATTACHMENT_MAX_BYTES)} each: scripts, images, PDFs, documents, audio. Videos go in Drive or Frame.io, with the link above.
          </p>
          <input ref={input} type="file" multiple accept={ATTACHMENT_ACCEPT} className="sr-only" aria-label="Choose files to attach" onChange={(e) => pick(e.target.files)} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Managers, QC and the assigned editor can attach files to this task. Everyone on the team can open them.</p>
      )}

      {uploads.length > 0 && (
        <ul className="space-y-2" aria-label="Uploads">
          {uploads.map((u) => (
            <li key={u.id} className="rounded-lg border border-border/70 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{u.fileName}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{u.status === 'uploading' ? `${Math.round(u.progress * 100)}%` : formatBytes(u.size)}</span>
                <IconButton
                  aria-label={u.status === 'uploading' ? `Cancel upload of ${u.fileName}` : `Dismiss ${u.fileName}`}
                  icon={<X className="h-3.5 w-3.5" />}
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 shrink-0"
                  onClick={() => (u.status === 'uploading' ? cancel(u.id) : dismiss(u.id))}
                />
              </div>
              {u.status === 'uploading' ? (
                <Progress value={u.progress * 100} aria-label={`Uploading ${u.fileName}`} className="mt-1.5 h-1.5" />
              ) : (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  {u.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {items.length === 0 && uploads.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">No files attached yet.</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/70" aria-label="Attached files">
          {items.map((a) => {
            const who = a.uploadedBy ? memberName(lookup, a.uploadedBy) : 'a former member';
            return (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                <FileTypeIcon mime={a.mimeType} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={a.fileName}>
                    {a.fileName}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {attachmentKind(a.mimeType)} · {formatBytes(a.sizeBytes)} · {who} · {timeAgo(a.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <IconButton
                    aria-label={`Open ${a.fileName}`}
                    icon={busyId === `${a.id}:open` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8"
                    onClick={() => void act(a, 'open')}
                  />
                  <IconButton
                    aria-label={`Download ${a.fileName}`}
                    icon={busyId === `${a.id}:download` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8"
                    onClick={() => void act(a, 'download')}
                  />
                  {canDeleteAttachment(a, user?.id, role) && (
                    <IconButton
                      aria-label={`Remove ${a.fileName}`}
                      icon={<Trash2 className="h-4 w-4" />}
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleting(a)}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{deleting?.fileName}”?</AlertDialogTitle>
            <AlertDialogDescription>The file is deleted for everyone and cannot be recovered. The activity feed keeps a note that it was attached and removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleting) remove.mutate(deleting);
                setDeleting(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AttachmentsSection;

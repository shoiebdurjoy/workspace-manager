import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/ui/user-avatar';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/use-auth';
import { useAddComment, useComments, useDeleteComment, useEditComment } from '@/hooks/use-collaboration';
import { useWorkspaceMembers } from '@/hooks/use-team';
import { can } from '@/lib/permissions';
import { canDeleteComment, canEditComment, timeAgo } from '@/lib/collaboration';
import { memberLookup, memberName } from '@/lib/tasks';
import type { TaskComment } from '@/types/database';
import { cn } from '@/lib/utils';
import CommentComposer from './CommentComposer';
import MentionText from './MentionText';

interface CommentThreadProps {
  taskId: string;
  /** A comment to scroll to and highlight (deep link from a notification). */
  focusCommentId?: string | null;
}

/**
 * The conversation on a task: oldest first, the box at the bottom. Posting shows the comment at once and
 * puts the text back if it fails. Authors edit and delete their own; Owners and Admins can delete any.
 */
const CommentThread: React.FC<CommentThreadProps> = ({ taskId, focusCommentId }) => {
  const { user, role } = useAuth();
  const comments = useComments(taskId);
  const { data: members = [] } = useWorkspaceMembers();
  const add = useAddComment(taskId);
  const edit = useEditComment(taskId);
  const remove = useDeleteComment(taskId);
  const lookup = useMemo(() => memberLookup(members), [members]);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TaskComment | null>(null);
  const canPost = can(role, 'comments:post');

  // a comment from a notification: scroll to it once it is on screen, and mark it for a moment
  const [flash, setFlash] = useState<string | null>(null);
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!focusCommentId || done.current === focusCommentId || !comments.data) return;
    const el = document.getElementById(`comment-${focusCommentId}`);
    if (!el) return;
    done.current = focusCommentId;
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    setFlash(focusCommentId);
    const t = window.setTimeout(() => setFlash(null), 2500);
    return () => window.clearTimeout(t);
  }, [focusCommentId, comments.data]);

  if (comments.isLoading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading comments">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-4/5" />
      </div>
    );
  }
  if (comments.isError) {
    return <ErrorState title="Comments could not be loaded" message={comments.error instanceof Error ? comments.error.message : 'Please try again.'} onRetry={() => void comments.refetch()} />;
  }

  const items = comments.data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="min-h-0 flex-1 space-y-4 lg:overflow-y-auto lg:pr-1">
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border/80 px-4 py-6 text-center">
          <MessageSquare aria-hidden className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-medium">No comments yet</p>
          <p className="text-xs text-muted-foreground">Questions, feedback and decisions about this video go here, where the whole team can see them.</p>
        </div>
      ) : (
        <ol className="space-y-4" aria-label="Comments">
          {items.map((c) => {
            const own = canEditComment(c, user?.id);
            const authorProfile = c.authorId ? lookup.get(c.authorId)?.profile : undefined;
            const name = c.authorId ? memberName(lookup, c.authorId) : 'Former member';
            return (
              <li
                key={c.id}
                id={`comment-${c.id}`}
                className={cn('group flex gap-2.5 rounded-lg p-1.5 transition-colors', flash === c.id && 'bg-primary/10 ring-1 ring-primary/30')}
              >
                <UserAvatar name={name} src={authorProfile?.avatarUrl ?? undefined} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-semibold">{name}</span>
                    <time dateTime={c.createdAt} title={new Date(c.createdAt).toLocaleString()} className="shrink-0 text-[11px] text-muted-foreground">
                      {timeAgo(c.createdAt)}
                    </time>
                    {c.editedAt && (
                      <span className="shrink-0 text-[11px] text-muted-foreground" title={`Edited ${new Date(c.editedAt).toLocaleString()}`}>
                        (edited)
                      </span>
                    )}
                    {canDeleteComment(c, user?.id, role) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            aria-label={`Actions for the comment by ${name}`}
                            icon={<MoreHorizontal className="h-4 w-4" />}
                            variant="ghost"
                            size="sm"
                            className="ml-auto h-6 w-6 shrink-0 opacity-60 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          {own && (
                            <DropdownMenuItem className="cursor-pointer text-xs" onSelect={() => setEditing(c.id)}>
                              <Pencil className="mr-2 h-3.5 w-3.5" />
                              Edit
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="cursor-pointer text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
                            onSelect={() => setDeleting(c)}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  {editing === c.id ? (
                    <div className="mt-1.5">
                      <CommentComposer
                        label="Edit comment"
                        members={members}
                        selfId={user?.id}
                        initialValue={c.body}
                        submitLabel="Save"
                        autoFocus
                        onCancel={() => setEditing(null)}
                        onSubmit={async (body) => {
                          if (body.trim() !== c.body.trim()) await edit.mutateAsync({ commentId: c.id, body });
                          setEditing(null);
                        }}
                      />
                    </div>
                  ) : (
                    <MentionText body={c.body} selfId={user?.id} className="mt-0.5" />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      </div>

      {canPost ? (
        <div className="shrink-0 border-t border-border/60 pt-3">
          <CommentComposer
            label="Write a comment"
            members={members}
            selfId={user?.id}
            onSubmit={(body) => add.mutateAsync({ body, id: crypto.randomUUID() })}
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">You can read this conversation but not add to it.</p>
      )}

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
            <AlertDialogDescription>It is removed for everyone and cannot be recovered. People who were notified about it keep their notification.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleting) remove.mutate(deleting.id);
                setDeleting(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CommentThread;

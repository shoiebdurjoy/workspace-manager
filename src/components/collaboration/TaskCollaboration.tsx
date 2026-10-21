import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAttachments, useComments } from '@/hooks/use-collaboration';
import { isCollabTab, type CollabTab } from '@/lib/collaboration';
import ActivityFeed from './ActivityFeed';
import AttachmentsSection from './AttachmentsSection';
import CommentThread from './CommentThread';

interface TaskCollaborationProps {
  taskId: string;
  isAssignedEditor: boolean;
}

/**
 * Comments, files and activity for one task, as tabs under the task's properties. The open tab (and a
 * comment to jump to) live in the address (?tab=files, ?comment=<id>), so a link or a notification lands
 * on the right thing and Back behaves.
 */
const TaskCollaboration: React.FC<TaskCollaborationProps> = ({ taskId, isAssignedEditor }) => {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const comment = params.get('comment');
  // comments are the default tab, so a link to a comment needs no ?tab=
  const tab: CollabTab = isCollabTab(requested) ? requested : 'comments';
  const comments = useComments(taskId);
  const files = useAttachments(taskId);

  const setTab = (next: string) => {
    if (!isCollabTab(next)) return;
    setParams(
      (old) => {
        const p = new URLSearchParams(old);
        p.set('tab', next);
        if (next !== 'comments') p.delete('comment');
        return p;
      },
      { replace: true }
    );
  };

  const openComment = (id: string) =>
    setParams(
      (old) => {
        const p = new URLSearchParams(old);
        p.set('tab', 'comments');
        p.set('comment', id);
        return p;
      },
      { replace: true }
    );

  const count = (n: number | undefined) => (n ? <span className="ml-1.5 rounded-full bg-background/70 px-1.5 text-[10px] tabular-nums">{n}</span> : null);

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="h-9 w-full justify-start">
        <TabsTrigger value="comments" className="flex-1 text-xs sm:flex-none">
          Comments{count(comments.data?.length)}
        </TabsTrigger>
        <TabsTrigger value="files" className="flex-1 text-xs sm:flex-none">
          Files{count(files.data?.length)}
        </TabsTrigger>
        <TabsTrigger value="activity" className="flex-1 text-xs sm:flex-none">
          Activity
        </TabsTrigger>
      </TabsList>
      <TabsContent value="comments" className="mt-3">
        <CommentThread taskId={taskId} focusCommentId={comment} />
      </TabsContent>
      <TabsContent value="files" className="mt-3">
        <AttachmentsSection taskId={taskId} isAssignedEditor={isAssignedEditor} />
      </TabsContent>
      <TabsContent value="activity" className="mt-3">
        <ActivityFeed taskId={taskId} onOpenComment={openComment} />
      </TabsContent>
    </Tabs>
  );
};

export default TaskCollaboration;

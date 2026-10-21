import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import TaskDetailSheet from '@/components/tasks/TaskDetailSheet';
import TaskWorkspace from '@/components/tasks/TaskWorkspace';
import { useHierarchy } from '@/hooks/use-hierarchy';
import { useTask } from '@/hooks/use-tasks';
import { findListById, hierarchyPaths, isUuid } from '@/lib/hierarchy';

/**
 * A task opened over a view that spans lists (Everything, My Tasks). Its space, folder and list are looked up from the task, so the
 * sheet shows the usual breadcrumbs; a task that does not exist (or that the person cannot read) sends
 * them back to the view with a message instead of showing a broken sheet.
 */
export const SpanningTaskSheet: React.FC<{
  taskId: string;
  orderedIds: readonly string[];
  onClose: () => void;
  taskPath?: (taskId: string) => string;
}> = ({ taskId, orderedIds, onClose, taskPath = hierarchyPaths.everythingTask }) => {
  const valid = isUuid(taskId);
  const task = useTask(valid ? taskId : undefined);
  const tree = useHierarchy().data;
  const located = task.data && tree ? findListById(tree, task.data.listId) : undefined;
  const gone = !valid || (task.isError && (task.error as { code?: string } | null)?.code === 'NOT_FOUND') || (!!task.data && !!tree && !located);

  useEffect(() => {
    if (!gone) return;
    toast.error('That task was not found. It may have been deleted, or you may not have access to it.');
    onClose();
  }, [gone, onClose]);

  if (!located) return null;
  return (
    <TaskDetailSheet
      taskId={taskId}
      space={located.space}
      folder={located.folder}
      list={located.list}
      orderedIds={orderedIds}
      onClose={onClose}
      taskPath={taskPath}
      listFallback={false}
    />
  );
};

/** Every task the person can see across all spaces, with the same views, filters and search as a list. */
const EverythingPage: React.FC = () => {
  const navigate = useNavigate();
  const { search } = useLocation();
  const taskId = useMatch('/everything/tasks/:taskId')?.params.taskId;
  const [visibleOrder, setVisibleOrderState] = useState<string[]>([]);
  // only a real change of order re-renders the page (the workspace reports it after every render)
  const setVisibleOrder = useCallback(
    (ids: string[]) => setVisibleOrderState((prev) => (prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids)),
    []
  );
  const close = useCallback(() => navigate(`${hierarchyPaths.everything()}${search}`, { replace: true }), [navigate, search]);

  useEffect(() => {
    document.title = 'Everything · TBB Workspace';
  }, []);

  return (
    <div className="space-y-4">
      <header className="space-y-1 pt-1">
        <h1 className="page-title">Everything</h1>
        <p className="page-description">Every task you can see, across all spaces. Search, filter and switch between List, Board and Table.</p>
      </header>
      <TaskWorkspace scope={{ kind: 'everything' }} selectedTaskId={taskId} onVisibleOrder={setVisibleOrder} />
      {taskId && <SpanningTaskSheet taskId={taskId} orderedIds={visibleOrder} onClose={close} />}
    </div>
  );
};

export default EverythingPage;

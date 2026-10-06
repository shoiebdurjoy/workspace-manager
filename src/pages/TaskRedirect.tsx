import React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/loading-state';
import { ErrorState } from '@/components/ui/error-state';
import { useHierarchy } from '@/hooks/use-hierarchy';
import { useTask } from '@/hooks/use-tasks';
import { findListById, hierarchyPaths, isUuid } from '@/lib/hierarchy';

/**
 * /tasks/:taskId: a stable link that needs only a task id (notifications, search results and
 * My Tasks in later phases). It resolves the task's list and space and forwards to the canonical
 * URL, so the sidebar and breadcrumbs light up exactly as if the person had navigated there.
 * Missing, deleted and "not yours" all look the same.
 */
const TaskRedirect: React.FC = () => {
  const { taskId } = useParams();
  const valid = isUuid(taskId);
  const task = useTask(valid ? taskId : undefined);
  const tree = useHierarchy();

  const notFound = (
    <div className="mx-auto max-w-md py-16 text-center" role="alert">
      <SearchX className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
      <h1 className="text-base font-semibold">Task not found</h1>
      <p className="mt-1 text-sm text-muted-foreground">It may have been deleted, or you may not have access to it.</p>
      <Button asChild className="mt-4" variant="outline">
        <Link to="/home">Back to Home</Link>
      </Button>
    </div>
  );

  if (!valid) return notFound;
  if (task.isError) {
    return (task.error as { code?: string } | null)?.code === 'NOT_FOUND' ? (
      notFound
    ) : (
      <ErrorState title="The task could not be loaded" message={task.error instanceof Error ? task.error.message : 'Please try again.'} onRetry={() => void task.refetch()} />
    );
  }
  if (tree.isError) {
    return <ErrorState title="The workspace could not be loaded" message={tree.error instanceof Error ? tree.error.message : 'Please try again.'} onRetry={() => void tree.refetch()} />;
  }
  if (!task.data || !tree.data) return <LoadingState title="Opening task" description="One moment..." />;

  const hit = findListById(tree.data, task.data.listId);
  if (!hit) return notFound;
  return <Navigate to={hierarchyPaths.task(hit.space.id, hit.list.id, task.data.id)} replace />;
};

export default TaskRedirect;

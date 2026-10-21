import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import TaskWorkspace from '@/components/tasks/TaskWorkspace';
import { hierarchyPaths } from '@/lib/hierarchy';
import { SpanningTaskSheet } from './EverythingPage';

/**
 * My Tasks: every task where the signed-in person is the editor or the QC reviewer, grouped by what
 * needs them (their next step first, then by the nearest date). The same views, filters and task sheet
 * as a list; the database decides which tasks are theirs (search_tasks, "assigned to me").
 */
const MyTasksPage: React.FC = () => {
  const navigate = useNavigate();
  const { search } = useLocation();
  const taskId = useMatch('/my-tasks/tasks/:taskId')?.params.taskId;
  const [visibleOrder, setVisibleOrderState] = useState<string[]>([]);
  const setVisibleOrder = useCallback(
    (ids: string[]) => setVisibleOrderState((prev) => (prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids)),
    []
  );
  const close = useCallback(() => navigate(`${hierarchyPaths.myTasks()}${search}`, { replace: true }), [navigate, search]);

  useEffect(() => {
    document.title = 'My Tasks · TBB Workspace';
  }, []);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">My Tasks</h1>
        <p className="text-xs text-muted-foreground">
          Everything you edit or review. What needs your next step comes first, then the rest by its nearest date.
        </p>
      </header>
      <TaskWorkspace scope={{ kind: 'mine' }} selectedTaskId={taskId} onVisibleOrder={setVisibleOrder} />
      {taskId && <SpanningTaskSheet taskId={taskId} orderedIds={visibleOrder} onClose={close} taskPath={hierarchyPaths.myTask} />}
    </div>
  );
};

export default MyTasksPage;

import React, { useCallback, useEffect, useState } from 'react';
import { useMatch, useNavigate, useParams } from 'react-router-dom';
import { ListTodo } from 'lucide-react';
import HierarchyGate from '@/components/hierarchy/HierarchyGate';
import HierarchyPageHeader from '@/components/hierarchy/HierarchyPageHeader';
import { ListMenu } from '@/components/hierarchy/NodeMenus';
import TaskList from '@/components/tasks/TaskList';
import TaskDetailSheet from '@/components/tasks/TaskDetailSheet';
import { findList, hierarchyPaths } from '@/lib/hierarchy';
import type { HierarchyFolder, HierarchyList, HierarchySpace } from '@/types/database';

const ListView: React.FC<{
  space: HierarchySpace;
  folder: HierarchyFolder | null;
  list: HierarchyList;
  taskId?: string;
}> = ({ space, folder, list, taskId }) => {
  const navigate = useNavigate();
  const [visibleOrder, setVisibleOrderState] = useState<string[]>([]);
  // only a real change of order re-renders the page (the list reports it after every render)
  const setVisibleOrder = useCallback(
    (ids: string[]) => setVisibleOrderState((prev) => (prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids)),
    []
  );
  useEffect(() => {
    document.title = `${list.name} · TBB Workspace`;
  }, [list.name]);

  const trail = [
    { label: space.name, href: hierarchyPaths.space(space.id) },
    ...(folder ? [{ label: folder.name, href: hierarchyPaths.folder(space.id, folder.id) }] : []),
  ];

  return (
    <div className="space-y-6">
      <HierarchyPageHeader
        icon={<ListTodo className="h-8 w-8 shrink-0" style={{ color: list.color }} />}
        title={list.name}
        description={list.description}
        trail={trail}
        actions={<ListMenu space={space} folder={folder} list={list} />}
      />

      <TaskList space={space} list={list} selectedTaskId={taskId} onVisibleOrder={setVisibleOrder} />

      {/* The task opens as a side sheet over the list; closing it returns to the plain list URL. */}
      {taskId && (
        <TaskDetailSheet
          taskId={taskId}
          space={space}
          folder={folder}
          list={list}
          orderedIds={visibleOrder}
          onClose={() => navigate(hierarchyPaths.list(space.id, list.id), { replace: true })}
        />
      )}
    </div>
  );
};

const ListPage: React.FC = () => {
  const { spaceId, listId } = useParams();
  // The task id lives on a child route (tasks/:taskId) so this page stays mounted while the sheet opens.
  const taskId = useMatch('/spaces/:spaceId/lists/:listId/tasks/:taskId')?.params.taskId;
  return (
    <HierarchyGate what="list" ids={[spaceId, listId]} resolve={(tree) => findList(tree, spaceId, listId)}>
      {({ space, folder, list }) => <ListView space={space} folder={folder} list={list} taskId={taskId} />}
    </HierarchyGate>
  );
};

export default ListPage;

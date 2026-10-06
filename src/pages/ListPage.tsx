import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ClipboardList, ListTodo } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import HierarchyGate from '@/components/hierarchy/HierarchyGate';
import HierarchyPageHeader from '@/components/hierarchy/HierarchyPageHeader';
import { ListMenu } from '@/components/hierarchy/NodeMenus';
import { findList, hierarchyPaths } from '@/lib/hierarchy';
import type { HierarchyFolder, HierarchyList, HierarchySpace } from '@/types/database';

const ListView: React.FC<{ space: HierarchySpace; folder: HierarchyFolder | null; list: HierarchyList }> = ({
  space,
  folder,
  list,
}) => {
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

      {/* The Task Engine (Phase 6) renders here. Nothing is simulated in the meantime. */}
      <EmptyState
        icon={<ClipboardList className="h-6 w-6" />}
        title="No tasks yet"
        description="This list is ready. Video tasks, statuses and the QC workflow arrive with the task engine in the next phase."
      />
    </div>
  );
};

const ListPage: React.FC = () => {
  const { spaceId, listId } = useParams();
  return (
    <HierarchyGate what="list" ids={[spaceId, listId]} resolve={(tree) => findList(tree, spaceId, listId)}>
      {({ space, folder, list }) => <ListView space={space} folder={folder} list={list} />}
    </HierarchyGate>
  );
};

export default ListPage;

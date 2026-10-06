import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Folder, ListPlus, ListTodo } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import HierarchyGate from '@/components/hierarchy/HierarchyGate';
import HierarchyPageHeader from '@/components/hierarchy/HierarchyPageHeader';
import NodeCard from '@/components/hierarchy/NodeCard';
import { FolderMenu, ListMenu } from '@/components/hierarchy/NodeMenus';
import { useCan } from '@/hooks/use-auth';
import { useHierarchyDialogs } from '@/hooks/use-hierarchy-dialogs';
import { findFolder, hierarchyPaths } from '@/lib/hierarchy';
import type { HierarchyFolder, HierarchySpace } from '@/types/database';

const FolderView: React.FC<{ space: HierarchySpace; folder: HierarchyFolder }> = ({ space, folder }) => {
  const dialogs = useHierarchyDialogs();
  const canCreate = useCan('folder-list:create');

  useEffect(() => {
    document.title = `${folder.name} · TBB Workspace`;
  }, [folder.name]);

  return (
    <div className="space-y-6">
      <HierarchyPageHeader
        icon={<Folder className="h-8 w-8 shrink-0 text-muted-foreground" />}
        title={folder.name}
        description={folder.description}
        trail={[{ label: space.name, href: hierarchyPaths.space(space.id) }]}
        actions={
          <>
            {canCreate && (
              <Button size="sm" className="h-8 text-xs" onClick={() => dialogs.open({ type: 'list', space, folderId: folder.id })}>
                <ListPlus className="mr-1.5 h-3.5 w-3.5" /> New list
              </Button>
            )}
            <FolderMenu space={space} folder={folder} />
          </>
        }
      />

      {folder.lists.length === 0 ? (
        <EmptyState
          icon={<ListTodo className="h-6 w-6" />}
          title="No lists in this folder"
          description={canCreate ? 'Create a list for a client or content queue.' : 'An Owner, Admin or Production Manager can add lists.'}
          action={
            canCreate ? (
              <Button size="sm" onClick={() => dialogs.open({ type: 'list', space, folderId: folder.id })}>
                <ListPlus className="mr-1.5 h-3.5 w-3.5" /> New list
              </Button>
            ) : undefined
          }
        />
      ) : (
        <section aria-label="Lists" className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lists ({folder.lists.length})</h2>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {folder.lists.map((list) => (
              <NodeCard
                key={list.id}
                to={hierarchyPaths.list(space.id, list.id)}
                icon={<ListTodo className="h-5 w-5 shrink-0" style={{ color: list.color }} />}
                title={list.name}
                actions={<ListMenu space={space} folder={folder} list={list} />}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

const FolderPage: React.FC = () => {
  const { spaceId, folderId } = useParams();
  return (
    <HierarchyGate what="folder" ids={[spaceId, folderId]} resolve={(tree) => findFolder(tree, spaceId, folderId)}>
      {({ space, folder }) => <FolderView space={space} folder={folder} />}
    </HierarchyGate>
  );
};

export default FolderPage;

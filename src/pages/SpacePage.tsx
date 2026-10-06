import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Folder, FolderPlus, ListPlus, ListTodo } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import HierarchyGate from '@/components/hierarchy/HierarchyGate';
import HierarchyPageHeader from '@/components/hierarchy/HierarchyPageHeader';
import NodeCard from '@/components/hierarchy/NodeCard';
import SpaceIcon from '@/components/hierarchy/SpaceIcon';
import { FolderMenu, ListMenu, SpaceMenu } from '@/components/hierarchy/NodeMenus';
import { useCan } from '@/hooks/use-auth';
import { useHierarchyDialogs } from '@/hooks/use-hierarchy-dialogs';
import { countListsInSpace, findSpace, hierarchyPaths } from '@/lib/hierarchy';
import type { HierarchySpace } from '@/types/database';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const SpaceView: React.FC<{ space: HierarchySpace }> = ({ space }) => {
  const dialogs = useHierarchyDialogs();
  const canCreate = useCan('folder-list:create');
  const isEmpty = space.folders.length === 0 && space.folderlessLists.length === 0;

  useEffect(() => {
    document.title = `${space.name} · TBB Workspace`;
  }, [space.name]);

  return (
    <div className="space-y-6">
      <HierarchyPageHeader
        icon={<SpaceIcon icon={space.icon} color={space.color} size="md" className="h-10 w-10 [&>svg]:h-5 [&>svg]:w-5" />}
        title={space.name}
        description={space.description}
        actions={
          <>
            {canCreate && (
              <>
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => dialogs.open({ type: 'folder', space })}>
                  <FolderPlus className="mr-1.5 h-3.5 w-3.5" /> New folder
                </Button>
                <Button size="sm" className="h-8 text-xs" onClick={() => dialogs.open({ type: 'list', space })}>
                  <ListPlus className="mr-1.5 h-3.5 w-3.5" /> New list
                </Button>
              </>
            )}
            <SpaceMenu space={space} />
          </>
        }
      />

      {isEmpty ? (
        <EmptyState
          icon={<Folder className="h-6 w-6" />}
          title="This space is empty"
          description={
            canCreate
              ? 'Add a folder to group a client pod, or a list for a single client queue.'
              : 'An Owner, Admin or Production Manager can add folders and lists.'
          }
          action={
            canCreate ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => dialogs.open({ type: 'folder', space })}>
                  <FolderPlus className="mr-1.5 h-3.5 w-3.5" /> New folder
                </Button>
                <Button size="sm" onClick={() => dialogs.open({ type: 'list', space })}>
                  <ListPlus className="mr-1.5 h-3.5 w-3.5" /> New list
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <>
          {space.folders.length > 0 && (
            <section aria-label="Folders" className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Folders ({space.folders.length})
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {space.folders.map((folder) => (
                  <NodeCard
                    key={folder.id}
                    to={hierarchyPaths.folder(space.id, folder.id)}
                    icon={<Folder className="h-5 w-5 shrink-0 text-muted-foreground" />}
                    title={folder.name}
                    subtitle={plural(folder.lists.length, 'list')}
                    actions={<FolderMenu space={space} folder={folder} />}
                  />
                ))}
              </div>
            </section>
          )}
          {space.folderlessLists.length > 0 && (
            <section aria-label="Lists" className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Lists ({space.folderlessLists.length})
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {space.folderlessLists.map((list) => (
                  <NodeCard
                    key={list.id}
                    to={hierarchyPaths.list(space.id, list.id)}
                    icon={<ListTodo className="h-5 w-5 shrink-0" style={{ color: list.color }} />}
                    title={list.name}
                    actions={<ListMenu space={space} folder={null} list={list} />}
                  />
                ))}
              </div>
            </section>
          )}
          <p className="text-[11px] text-muted-foreground">
            {plural(space.folders.length, 'folder')} and {plural(countListsInSpace(space), 'list')} in this space.
          </p>
        </>
      )}
    </div>
  );
};

const SpacePage: React.FC = () => {
  const { spaceId } = useParams();
  return (
    <HierarchyGate what="space" ids={[spaceId]} resolve={(tree) => findSpace(tree, spaceId)}>
      {(space) => <SpaceView space={space} />}
    </HierarchyGate>
  );
};

export default SpacePage;

import React, { useEffect } from 'react';
import { Link, matchPath, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, Folder, FolderOpen, Layers, ListTodo, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/hooks/use-auth';
import { useHierarchy } from '@/hooks/use-hierarchy';
import { useHierarchyDialogs } from '@/hooks/use-hierarchy-dialogs';
import { useExpandedNodes } from '@/hooks/use-expanded-nodes';
import { can } from '@/lib/permissions';
import { findList, hierarchyPaths } from '@/lib/hierarchy';
import type { HierarchyFolder, HierarchyList, HierarchySpace } from '@/types/database';
import SpaceIcon from './SpaceIcon';
import { FolderMenu, ListMenu, SpaceMenu } from './NodeMenus';

interface SpacesTreeProps {
  collapsed: boolean;
  /** Called after any navigation (closes the mobile drawer). */
  onNavigate?: () => void;
}

const MENU_REVEAL = 'opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 data-[state=open]:opacity-100';

const rowBase =
  'group flex items-center gap-1 rounded-md pr-1 text-[11px] transition-colors hover:bg-muted/50';
const activeRow = 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 font-semibold';

const Chevron: React.FC<{ open: boolean; label: string; onClick: () => void }> = ({ open, label, onClick }) => (
  <button
    type="button"
    aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
    aria-expanded={open}
    onClick={onClick}
    className="flex h-6 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
  >
    {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
  </button>
);

const ListRow: React.FC<{
  space: HierarchySpace;
  folder: HierarchyFolder | null;
  list: HierarchyList;
  active: boolean;
  onNavigate?: () => void;
}> = ({ space, folder, list, active, onNavigate }) => (
  <div className={cn(rowBase, 'pl-1', active && activeRow)}>
    <Link
      to={hierarchyPaths.list(space.id, list.id)}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className="flex min-w-0 flex-1 items-center gap-1.5 rounded py-1 pl-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ListTodo className="h-3 w-3 shrink-0" style={{ color: list.color }} />
      <span className="truncate">{list.name}</span>
    </Link>
    <ListMenu space={space} folder={folder} list={list} className={MENU_REVEAL} />
  </div>
);

const SpacesTree: React.FC<SpacesTreeProps> = ({ collapsed, onNavigate }) => {
  const { role } = useAuth();
  const { pathname } = useLocation();
  const { data: tree, isLoading, isError, error, refetch } = useHierarchy();
  const dialogs = useHierarchyDialogs();
  const { expanded, toggle, reveal } = useExpandedNodes();
  const canCreateSpace = can(role, 'space:create');

  const spaceMatch = matchPath('/spaces/:spaceId/*', pathname);
  const folderMatch = matchPath('/spaces/:spaceId/folders/:folderId', pathname);
  const listMatch = matchPath('/spaces/:spaceId/lists/:listId', pathname);
  const activeSpaceId = spaceMatch?.params.spaceId;
  const activeFolderId = folderMatch?.params.folderId;
  const activeListId = listMatch?.params.listId;

  // Reveal the active route inside the tree (deep links, refresh, navigation from elsewhere).
  useEffect(() => {
    if (!tree || !activeSpaceId) return;
    const ids = [activeSpaceId];
    if (activeListId) {
      const hit = findList(tree, activeSpaceId, activeListId);
      if (hit?.folder) ids.push(hit.folder.id);
    }
    reveal(ids);
  }, [tree, activeSpaceId, activeListId, reveal]);

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1" aria-label="Spaces">
        {(tree ?? []).map((space) => (
          <Tooltip key={space.id}>
            <TooltipTrigger asChild>
              <Link
                to={hierarchyPaths.space(space.id)}
                onClick={onNavigate}
                aria-label={space.name}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  activeSpaceId === space.id && 'bg-purple-100 dark:bg-purple-950/70'
                )}
              >
                <SpaceIcon icon={space.icon} color={space.color} size="sm" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs font-semibold">
              {space.name}
            </TooltipContent>
          </Tooltip>
        ))}
        {(!tree || tree.length === 0) && (
          <span className="flex h-9 w-9 items-center justify-center text-muted-foreground/50" aria-hidden="true">
            <Layers className="h-4 w-4" />
          </span>
        )}
      </div>
    );
  }

  return (
    <section aria-label="Spaces" className="space-y-1">
      <div className="flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Layers className="h-3 w-3" />
          Spaces
        </span>
        {canCreateSpace && (
          <IconButton
            aria-label="New space"
            tooltip="New space"
            icon={<Plus className="h-3.5 w-3.5" />}
            variant="ghost"
            size="xs"
            onClick={() => dialogs.open({ type: 'space' })}
          />
        )}
      </div>

      {isLoading && (
        <div className="space-y-1.5 px-2 py-1" role="status" aria-label="Loading spaces">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-5 w-3/5" />
        </div>
      )}

      {isError && (
        <div role="alert" className="mx-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px]">
          <p className="text-destructive">{error instanceof Error ? error.message : 'Spaces could not be loaded.'}</p>
          <button type="button" onClick={() => void refetch()} className="mt-1 font-medium text-primary hover:underline">
            Try again
          </button>
        </div>
      )}

      {tree && tree.length === 0 && (
        <div className="px-2 py-1 text-[11px] leading-relaxed text-muted-foreground">
          <p>No spaces yet.</p>
          {canCreateSpace ? (
            <button
              type="button"
              onClick={() => dialogs.open({ type: 'space' })}
              className="mt-1 font-medium text-primary hover:underline"
            >
              Create your first space
            </button>
          ) : (
            <p className="mt-0.5">An Owner or Admin can create spaces.</p>
          )}
        </div>
      )}

      {tree && tree.length > 0 && (
        <ul className="space-y-0.5">
          {tree.map((space) => {
            const open = expanded.has(space.id);
            const spaceActive = activeSpaceId === space.id && !activeFolderId && !activeListId;
            return (
              <li key={space.id}>
                <div className={cn(rowBase, 'text-xs', spaceActive && activeRow)}>
                  <Chevron open={open} label={space.name} onClick={() => toggle(space.id)} />
                  <Link
                    to={hierarchyPaths.space(space.id)}
                    onClick={onNavigate}
                    aria-current={spaceActive ? 'page' : undefined}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <SpaceIcon icon={space.icon} color={space.color} size="xs" />
                    <span className="truncate font-medium">{space.name}</span>
                  </Link>
                  <SpaceMenu space={space} className={MENU_REVEAL} />
                </div>

                {open && (
                  <ul className="ml-3 space-y-0.5 border-l border-border/60 pl-1.5 py-0.5">
                    {space.folders.map((folder) => {
                      const folderOpen = expanded.has(folder.id);
                      const folderActive = activeFolderId === folder.id;
                      return (
                        <li key={folder.id}>
                          <div className={cn(rowBase, folderActive && activeRow)}>
                            <Chevron open={folderOpen} label={folder.name} onClick={() => toggle(folder.id)} />
                            <Link
                              to={hierarchyPaths.folder(space.id, folder.id)}
                              onClick={onNavigate}
                              aria-current={folderActive ? 'page' : undefined}
                              className="flex min-w-0 flex-1 items-center gap-1.5 rounded py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {folderOpen ? <FolderOpen className="h-3 w-3 shrink-0" /> : <Folder className="h-3 w-3 shrink-0" />}
                              <span className="truncate">{folder.name}</span>
                            </Link>
                            <FolderMenu space={space} folder={folder} className={MENU_REVEAL} />
                          </div>
                          {folderOpen && (
                            <ul className="ml-3 space-y-0.5 border-l border-border/40 pl-1">
                              {folder.lists.length === 0 && (
                                <li className="px-2 py-0.5 text-[10px] text-muted-foreground/70">No lists</li>
                              )}
                              {folder.lists.map((list) => (
                                <li key={list.id}>
                                  <ListRow
                                    space={space}
                                    folder={folder}
                                    list={list}
                                    active={activeListId === list.id}
                                    onNavigate={onNavigate}
                                  />
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                    {space.folderlessLists.map((list) => (
                      <li key={list.id}>
                        <ListRow space={space} folder={null} list={list} active={activeListId === list.id} onNavigate={onNavigate} />
                      </li>
                    ))}
                    {space.folders.length === 0 && space.folderlessLists.length === 0 && (
                      <li className="px-2 py-0.5 text-[10px] text-muted-foreground/70">Empty space</li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default SpacesTree;

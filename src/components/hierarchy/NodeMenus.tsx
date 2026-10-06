import React from 'react';
import { ArrowDown, ArrowUp, FolderPlus, ListPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { useAuth } from '@/hooks/use-auth';
import { useHierarchy, useReorder } from '@/hooks/use-hierarchy';
import { useHierarchyDialogs } from '@/hooks/use-hierarchy-dialogs';
import { can } from '@/lib/permissions';
import { moveWithin } from '@/lib/hierarchy';
import type { HierarchyFolder, HierarchyList, HierarchySpace } from '@/types/database';

interface MenuShellProps {
  label: string;
  className?: string;
  children: React.ReactNode;
}

const MenuShell: React.FC<MenuShellProps> = ({ label, className, children }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <IconButton
        aria-label={`Actions for ${label}`}
        icon={<MoreHorizontal className="h-3.5 w-3.5" />}
        variant="ghost"
        size="xs"
        className={className}
        onClick={(e) => e.stopPropagation()}
      />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-48" onClick={(e) => e.stopPropagation()}>
      {children}
    </DropdownMenuContent>
  </DropdownMenu>
);

function useMoveItems(kind: 'space' | 'folder' | 'list', ids: string[], id: string, allowed: boolean) {
  const reorder = useReorder();
  const up = moveWithin(ids, id, 'up');
  const down = moveWithin(ids, id, 'down');
  const items = allowed ? (
    <>
      <DropdownMenuItem disabled={!up || reorder.isPending} onSelect={() => up && reorder.mutate({ kind, ids: up })} className="text-xs">
        <ArrowUp className="mr-2 h-3.5 w-3.5" /> Move up
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!down || reorder.isPending} onSelect={() => down && reorder.mutate({ kind, ids: down })} className="text-xs">
        <ArrowDown className="mr-2 h-3.5 w-3.5" /> Move down
      </DropdownMenuItem>
    </>
  ) : null;
  return items;
}

export const SpaceMenu: React.FC<{ space: HierarchySpace; className?: string }> = ({ space, className }) => {
  const { role } = useAuth();
  const dialogs = useHierarchyDialogs();
  const { data: tree = [] } = useHierarchy();
  const canCreate = can(role, 'folder-list:create');
  const canEdit = can(role, 'space:edit');
  const canDelete = can(role, 'space:delete');
  const move = useMoveItems('space', tree.map((s) => s.id), space.id, canEdit);
  if (!canCreate && !canEdit && !canDelete) return null;

  return (
    <MenuShell label={space.name} className={className}>
      {canCreate && (
        <>
          <DropdownMenuItem onSelect={() => dialogs.open({ type: 'folder', space })} className="text-xs">
            <FolderPlus className="mr-2 h-3.5 w-3.5" /> New folder
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => dialogs.open({ type: 'list', space })} className="text-xs">
            <ListPlus className="mr-2 h-3.5 w-3.5" /> New list
          </DropdownMenuItem>
        </>
      )}
      {canEdit && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => dialogs.open({ type: 'space', space })} className="text-xs">
            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit space
          </DropdownMenuItem>
          {move}
        </>
      )}
      {canDelete && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => dialogs.open({ type: 'delete-space', space })}
            className="text-xs text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete space
          </DropdownMenuItem>
        </>
      )}
    </MenuShell>
  );
};

export const FolderMenu: React.FC<{ space: HierarchySpace; folder: HierarchyFolder; className?: string }> = ({
  space,
  folder,
  className,
}) => {
  const { role } = useAuth();
  const dialogs = useHierarchyDialogs();
  const canCreate = can(role, 'folder-list:create');
  const canEdit = can(role, 'folder-list:edit');
  const canDelete = can(role, 'folder-list:delete');
  const move = useMoveItems('folder', space.folders.map((f) => f.id), folder.id, canEdit);
  if (!canCreate && !canEdit && !canDelete) return null;

  return (
    <MenuShell label={folder.name} className={className}>
      {canCreate && (
        <DropdownMenuItem onSelect={() => dialogs.open({ type: 'list', space, folderId: folder.id })} className="text-xs">
          <ListPlus className="mr-2 h-3.5 w-3.5" /> New list
        </DropdownMenuItem>
      )}
      {canEdit && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => dialogs.open({ type: 'folder', space, folder })} className="text-xs">
            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit folder
          </DropdownMenuItem>
          {move}
        </>
      )}
      {canDelete && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => dialogs.open({ type: 'delete-folder', space, folder })}
            className="text-xs text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete folder
          </DropdownMenuItem>
        </>
      )}
    </MenuShell>
  );
};

export const ListMenu: React.FC<{
  space: HierarchySpace;
  folder: HierarchyFolder | null;
  list: HierarchyList;
  className?: string;
}> = ({ space, folder, list, className }) => {
  const { role } = useAuth();
  const dialogs = useHierarchyDialogs();
  const canEdit = can(role, 'folder-list:edit');
  const canDelete = can(role, 'folder-list:delete');
  const siblings = folder ? folder.lists : space.folderlessLists;
  const move = useMoveItems('list', siblings.map((l) => l.id), list.id, canEdit);
  if (!canEdit && !canDelete) return null;

  return (
    <MenuShell label={list.name} className={className}>
      {canEdit && (
        <>
          <DropdownMenuItem onSelect={() => dialogs.open({ type: 'list', space, list })} className="text-xs">
            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit list
          </DropdownMenuItem>
          {move}
        </>
      )}
      {canDelete && (
        <>
          {canEdit && <DropdownMenuSeparator />}
          <DropdownMenuItem
            onSelect={() => dialogs.open({ type: 'delete-list', space, folder, list })}
            className="text-xs text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete list
          </DropdownMenuItem>
        </>
      )}
    </MenuShell>
  );
};

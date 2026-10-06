import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  createFolder,
  createList,
  createSpace,
  deleteFolder,
  deleteList,
  deleteSpace,
  getWorkspaceHierarchy,
  reorderHierarchy,
  updateFolder,
  updateList,
  updateSpace,
  type FolderInput,
  type HierarchyKind,
  type ListInput,
  type SpaceInput,
} from '@/database';
import type { HierarchySpace } from '@/types/database';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/permissions';
import { findSpace, nextPosition } from '@/lib/hierarchy';

export const hierarchyKey = (workspaceId: string) => ['workspace', workspaceId, 'hierarchy'] as const;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

/** The workspace tree: staff only (client viewers have no access until guest grants exist). */
export function useHierarchy() {
  const { workspace, role } = useAuth();
  const workspaceId = workspace?.id ?? '';
  return useQuery({
    queryKey: hierarchyKey(workspaceId),
    queryFn: () => getWorkspaceHierarchy(workspaceId),
    enabled: !!workspaceId && can(role, 'hierarchy:view'),
    staleTime: 30_000,
  });
}

function useTreeCache() {
  const { workspace } = useAuth();
  const queryClient = useQueryClient();
  const workspaceId = workspace?.id ?? '';
  return {
    workspaceId,
    tree: () => queryClient.getQueryData<HierarchySpace[]>(hierarchyKey(workspaceId)) ?? [],
    refresh: () => queryClient.invalidateQueries({ queryKey: hierarchyKey(workspaceId) }),
  };
}

export function useCreateSpace() {
  const { workspaceId, tree, refresh } = useTreeCache();
  return useMutation({
    mutationFn: (input: SpaceInput) => createSpace({ ...input, workspaceId, position: nextPosition(tree()) }),
    onSuccess: (space) => {
      toast.success(`Space "${space.name}" created`);
      void refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useUpdateSpace() {
  const { refresh } = useTreeCache();
  return useMutation({
    mutationFn: ({ spaceId, ...updates }: { spaceId: string } & Partial<SpaceInput>) => updateSpace(spaceId, updates),
    onSuccess: (space) => {
      toast.success(`Space "${space.name}" saved`);
      void refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useDeleteSpace() {
  const { refresh } = useTreeCache();
  return useMutation({
    mutationFn: (spaceId: string) => deleteSpace(spaceId),
    onSuccess: () => {
      toast.success('Space deleted');
      void refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useCreateFolder() {
  const { tree, refresh } = useTreeCache();
  return useMutation({
    mutationFn: ({ spaceId, ...input }: FolderInput & { spaceId: string }) =>
      createFolder({ ...input, spaceId, position: nextPosition(findSpace(tree(), spaceId)?.folders ?? []) }),
    onSuccess: (folder) => {
      toast.success(`Folder "${folder.name}" created`);
      void refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useUpdateFolder() {
  const { refresh } = useTreeCache();
  return useMutation({
    mutationFn: ({ folderId, ...updates }: { folderId: string } & Partial<FolderInput>) => updateFolder(folderId, updates),
    onSuccess: (folder) => {
      toast.success(`Folder "${folder.name}" saved`);
      void refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useDeleteFolder() {
  const { refresh } = useTreeCache();
  return useMutation({
    mutationFn: (folderId: string) => deleteFolder(folderId),
    onSuccess: () => {
      toast.success('Folder deleted');
      void refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useCreateList() {
  const { tree, refresh } = useTreeCache();
  return useMutation({
    mutationFn: ({ spaceId, ...input }: ListInput & { spaceId: string }) => {
      const space = findSpace(tree(), spaceId);
      const siblings = input.folderId
        ? space?.folders.find((f) => f.id === input.folderId)?.lists ?? []
        : space?.folderlessLists ?? [];
      return createList({ ...input, spaceId, position: nextPosition(siblings) });
    },
    onSuccess: (list) => {
      toast.success(`List "${list.name}" created`);
      void refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useUpdateList() {
  const { tree, refresh } = useTreeCache();
  return useMutation({
    mutationFn: ({
      listId,
      spaceId,
      ...updates
    }: { listId: string; spaceId: string } & Partial<ListInput>) => {
      // Moving to another folder appends the list to the end of its new parent.
      let position: number | undefined;
      if (updates.folderId !== undefined) {
        const space = findSpace(tree(), spaceId);
        const siblings = updates.folderId
          ? space?.folders.find((f) => f.id === updates.folderId)?.lists ?? []
          : space?.folderlessLists ?? [];
        const alreadyThere = siblings.some((l) => l.id === listId);
        position = alreadyThere ? undefined : nextPosition(siblings);
      }
      return updateList(listId, { ...updates, ...(position !== undefined ? { position } : {}) });
    },
    onSuccess: (list) => {
      toast.success(`List "${list.name}" saved`);
      void refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useDeleteList() {
  const { refresh } = useTreeCache();
  return useMutation({
    mutationFn: (listId: string) => deleteList(listId),
    onSuccess: () => {
      toast.success('List deleted');
      void refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useReorder() {
  const { refresh } = useTreeCache();
  return useMutation({
    mutationFn: ({ kind, ids }: { kind: HierarchyKind; ids: string[] }) => reorderHierarchy(kind, ids),
    onSettled: () => void refresh(),
    onError: (err) => toast.error(errorMessage(err)),
  });
}

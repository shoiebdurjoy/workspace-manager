import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useDeleteFolder, useDeleteList, useDeleteSpace } from '@/hooks/use-hierarchy';
import { countListsInSpace } from '@/lib/hierarchy';
import type { HierarchyDialogRequest } from './hierarchy-dialogs-context';

type DeleteRequest = Extract<HierarchyDialogRequest, { type: 'delete-space' | 'delete-folder' | 'delete-list' }>;

interface Props {
  request: DeleteRequest;
  onClose: () => void;
  onDeleted: (request: DeleteRequest) => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Destructive actions always ask first and say exactly what will be lost. A folder that still
 * has lists is not deletable (the database refuses), so the dialog explains instead of offering
 * a button that can only fail.
 */
const DeleteHierarchyDialog: React.FC<Props> = ({ request, onClose, onDeleted }) => {
  const deleteSpace = useDeleteSpace();
  const deleteFolder = useDeleteFolder();
  const deleteList = useDeleteList();
  const busy = deleteSpace.isPending || deleteFolder.isPending || deleteList.isPending;

  if (request.type === 'delete-folder' && request.folder.lists.length > 0) {
    return (
      <AlertDialog open onOpenChange={(open) => !open && onClose()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>"{request.folder.name}" is not empty</AlertDialogTitle>
            <AlertDialogDescription>
              This folder still contains {plural(request.folder.lists.length, 'list')}. Move them to another folder or
              delete them first, then delete the folder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  let title: string;
  let body: string;
  if (request.type === 'delete-space') {
    const folders = request.space.folders.length;
    const lists = countListsInSpace(request.space);
    title = `Delete space "${request.space.name}"?`;
    body =
      folders + lists === 0
        ? 'This space is empty. It will be permanently deleted.'
        : `This permanently deletes the space together with ${plural(folders, 'folder')} and ${plural(lists, 'list')} inside it, and everything in them. This cannot be undone.`;
  } else if (request.type === 'delete-folder') {
    title = `Delete folder "${request.folder.name}"?`;
    body = 'The empty folder will be permanently deleted. This cannot be undone.';
  } else {
    title = `Delete list "${request.list.name}"?`;
    body = 'The list and everything in it will be permanently deleted. This cannot be undone.';
  }

  const confirm = async (e: React.MouseEvent) => {
    // Keep the dialog open while the request runs; close it from the outcome.
    e.preventDefault();
    try {
      if (request.type === 'delete-space') await deleteSpace.mutateAsync(request.space.id);
      else if (request.type === 'delete-folder') await deleteFolder.mutateAsync(request.folder.id);
      else await deleteList.mutateAsync(request.list.id);
      onDeleted(request);
    } catch {
      // the mutation hook already showed the error toast; keep the dialog open to retry or cancel
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => void confirm(e)}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteHierarchyDialog;

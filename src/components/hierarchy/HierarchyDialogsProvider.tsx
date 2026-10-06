import React, { useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { HierarchyDialogRequest, HierarchyDialogsContext } from './hierarchy-dialogs-context';
import SpaceDialog from './SpaceDialog';
import FolderDialog from './FolderDialog';
import ListDialog from './ListDialog';
import DeleteHierarchyDialog from './DeleteHierarchyDialog';
import { hierarchyPaths } from '@/lib/hierarchy';

/**
 * Renders the one shared set of create / edit / delete dialogs. The sidebar, the pages and the
 * command palette only call `open(request)`; navigation after a save or delete lives here.
 */
export const HierarchyDialogsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [request, setRequest] = useState<HierarchyDialogRequest | null>(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const open = useCallback((next: HierarchyDialogRequest) => setRequest(next), []);
  const close = useCallback(() => setRequest(null), []);
  const api = useMemo(() => ({ open }), [open]);

  let dialog: React.ReactNode = null;
  if (request) {
    switch (request.type) {
      case 'space':
        dialog = (
          <SpaceDialog
            key={request.space?.id ?? 'new-space'}
            space={request.space}
            onClose={close}
            onSaved={(space) => {
              close();
              if (!request.space) navigate(hierarchyPaths.space(space.id));
            }}
          />
        );
        break;
      case 'folder':
        dialog = (
          <FolderDialog
            key={request.folder?.id ?? `new-folder-${request.space.id}`}
            space={request.space}
            folder={request.folder}
            onClose={close}
            onSaved={(folder) => {
              close();
              if (!request.folder) navigate(hierarchyPaths.folder(request.space.id, folder.id));
            }}
          />
        );
        break;
      case 'list':
        dialog = (
          <ListDialog
            key={request.list?.id ?? `new-list-${request.space.id}-${request.folderId ?? 'none'}`}
            space={request.space}
            folderId={request.folderId}
            list={request.list}
            onClose={close}
            onSaved={(list) => {
              close();
              if (!request.list) navigate(hierarchyPaths.list(request.space.id, list.id));
            }}
          />
        );
        break;
      default:
        dialog = (
          <DeleteHierarchyDialog
            request={request}
            onClose={close}
            onDeleted={(deleted) => {
              close();
              // If the page being viewed no longer exists, move to its nearest surviving parent.
              if (deleted.type === 'delete-space' && pathname.startsWith(hierarchyPaths.space(deleted.space.id))) {
                navigate('/home', { replace: true });
              } else if (deleted.type === 'delete-folder' && pathname === hierarchyPaths.folder(deleted.space.id, deleted.folder.id)) {
                navigate(hierarchyPaths.space(deleted.space.id), { replace: true });
              } else if (deleted.type === 'delete-list' && pathname === hierarchyPaths.list(deleted.space.id, deleted.list.id)) {
                navigate(
                  deleted.folder ? hierarchyPaths.folder(deleted.space.id, deleted.folder.id) : hierarchyPaths.space(deleted.space.id),
                  { replace: true }
                );
              }
            }}
          />
        );
    }
  }

  return (
    <HierarchyDialogsContext.Provider value={api}>
      {children}
      {dialog}
    </HierarchyDialogsContext.Provider>
  );
};

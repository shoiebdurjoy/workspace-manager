import { createContext } from 'react';
import type { HierarchyFolder, HierarchyList, HierarchySpace } from '@/types/database';

/** Everything the sidebar, pages and command palette can ask the shared dialogs to do. */
export type HierarchyDialogRequest =
  | { type: 'space'; space?: HierarchySpace }
  | { type: 'folder'; space: HierarchySpace; folder?: HierarchyFolder }
  | { type: 'list'; space: HierarchySpace; folderId?: string | null; list?: HierarchyList }
  | { type: 'delete-space'; space: HierarchySpace }
  | { type: 'delete-folder'; space: HierarchySpace; folder: HierarchyFolder }
  | { type: 'delete-list'; space: HierarchySpace; folder: HierarchyFolder | null; list: HierarchyList };

export interface HierarchyDialogsApi {
  open: (request: HierarchyDialogRequest) => void;
}

export const HierarchyDialogsContext = createContext<HierarchyDialogsApi | undefined>(undefined);

import { useContext } from 'react';
import { HierarchyDialogsContext, HierarchyDialogsApi } from '@/components/hierarchy/hierarchy-dialogs-context';

export function useHierarchyDialogs(): HierarchyDialogsApi {
  const api = useContext(HierarchyDialogsContext);
  if (!api) throw new Error('useHierarchyDialogs must be used within HierarchyDialogsProvider');
  return api;
}

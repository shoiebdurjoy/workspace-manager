import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createListFromTemplate, deleteTemplate, listTemplates, saveListAsTemplate } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/permissions';

export const templateKeys = { all: (ws: string) => ['workspace', ws, 'list-templates'] as const };

export function useTemplates() {
  const { workspace, role } = useAuth();
  const ws = workspace?.id ?? '';
  return useQuery({ queryKey: templateKeys.all(ws), queryFn: () => listTemplates(ws), enabled: !!ws && can(role, 'hierarchy:view'), staleTime: 60_000 });
}

export function useSaveTemplate() {
  const qc = useQueryClient();
  const { workspace } = useAuth();
  return useMutation({
    mutationFn: (v: { listId: string; name: string; description?: string }) => saveListAsTemplate(v.listId, v.name, v.description),
    onSuccess: () => {
      toast.success('Template saved');
      void qc.invalidateQueries({ queryKey: templateKeys.all(workspace?.id ?? '') });
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  const { workspace } = useAuth();
  return useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: templateKeys.all(workspace?.id ?? '') }),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'The template could not be deleted.'),
  });
}

/** Creates a list and its standard videos from a template; refreshes the hierarchy and the task views. */
export function useCreateListFromTemplate() {
  const qc = useQueryClient();
  const { workspace } = useAuth();
  return useMutation({
    mutationFn: createListFromTemplate,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workspace', workspace?.id ?? ''] });
    },
  });
}

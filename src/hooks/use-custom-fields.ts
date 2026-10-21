import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  countFieldValues,
  createCustomField,
  deleteCustomField,
  listCustomFields,
  listTaskFieldValues,
  reorderCustomFields,
  setTaskFieldValue,
  updateCustomField,
  type NewCustomField,
} from '@/database';
import type { CustomField, CustomFieldValue } from '@/types/database';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/permissions';

/**
 * Custom fields (Phase 12). Definitions are one list per workspace; a task's values are one map per task
 * (kept under the workspace's 'tasks' prefix, so anything that refreshes the tasks refreshes them).
 * Saving a value is optimistic: the screen shows it at once and puts the old one back, with a message,
 * if the database says no.
 */
export const fieldKeys = {
  all: (ws: string) => ['workspace', ws, 'custom-fields'] as const,
  count: (ws: string, fieldId: string) => ['workspace', ws, 'custom-fields', 'count', fieldId] as const,
  values: (ws: string, taskId: string) => ['workspace', ws, 'tasks', 'custom-values', taskId] as const,
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

function useFieldScope() {
  const { workspace, role } = useAuth();
  const workspaceId = workspace?.id ?? '';
  // staff only; client viewers have no task access (the database fails closed too)
  return { workspaceId, enabled: !!workspaceId && can(role, 'hierarchy:view') };
}

export function useCustomFields() {
  const { workspaceId, enabled } = useFieldScope();
  return useQuery({
    queryKey: fieldKeys.all(workspaceId),
    queryFn: () => listCustomFields(workspaceId),
    enabled,
    staleTime: 60_000,
  });
}

export function useTaskFieldValues(taskId: string | undefined) {
  const { workspaceId, enabled } = useFieldScope();
  return useQuery({
    queryKey: fieldKeys.values(workspaceId, taskId ?? ''),
    queryFn: () => listTaskFieldValues(taskId ?? ''),
    enabled: enabled && !!taskId,
    staleTime: 10_000,
  });
}

/** Resolves when saved; rejects (after a toast) when refused, so an input can put its old text back. */
export function useSetFieldValue(taskId: string) {
  const qc = useQueryClient();
  const { workspaceId } = useFieldScope();
  const key = fieldKeys.values(workspaceId, taskId);
  return useMutation({
    mutationFn: ({ fieldId, value }: { fieldId: string; value: CustomFieldValue | null }) => setTaskFieldValue(taskId, fieldId, value),
    onMutate: async ({ fieldId, value }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Map<string, CustomFieldValue>>(key);
      qc.setQueryData<Map<string, CustomFieldValue>>(key, (old) => {
        const next = new Map(old ?? []);
        if (value === null || value === '') next.delete(fieldId);
        else next.set(fieldId, value);
        return next;
      });
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      qc.setQueryData(key, ctx?.previous);
      toast.error(errorMessage(err));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

export function useCreateField() {
  const qc = useQueryClient();
  const { workspaceId } = useFieldScope();
  return useMutation({
    mutationFn: (input: NewCustomField) => createCustomField(workspaceId, input),
    onSuccess: (field) => {
      qc.setQueryData<CustomField[]>(fieldKeys.all(workspaceId), (old) => [...(old ?? []), field]);
      toast.success(`Added the field "${field.name}"`);
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => void qc.invalidateQueries({ queryKey: fieldKeys.all(workspaceId) }),
  });
}

export function useUpdateField() {
  const qc = useQueryClient();
  const { workspaceId } = useFieldScope();
  return useMutation({
    mutationFn: ({ fieldId, patch }: { fieldId: string; patch: Parameters<typeof updateCustomField>[1] }) =>
      updateCustomField(fieldId, patch),
    onSuccess: (saved) =>
      qc.setQueryData<CustomField[]>(fieldKeys.all(workspaceId), (old) => (old ?? []).map((f) => (f.id === saved.id ? saved : f))),
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => void qc.invalidateQueries({ queryKey: fieldKeys.all(workspaceId) }),
  });
}

export function useDeleteField() {
  const qc = useQueryClient();
  const { workspaceId } = useFieldScope();
  return useMutation({
    mutationFn: (fieldId: string) => deleteCustomField(fieldId),
    onSuccess: (_void, fieldId) => {
      qc.setQueryData<CustomField[]>(fieldKeys.all(workspaceId), (old) => (old ?? []).filter((f) => f.id !== fieldId));
      // the values of that field are gone on every task
      void qc.invalidateQueries({ queryKey: ['workspace', workspaceId, 'tasks', 'custom-values'] });
      toast.success('Field deleted');
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => void qc.invalidateQueries({ queryKey: fieldKeys.all(workspaceId) }),
  });
}

export function useReorderFields() {
  const qc = useQueryClient();
  const { workspaceId } = useFieldScope();
  return useMutation({
    mutationFn: (orderedIds: string[]) => reorderCustomFields(orderedIds),
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey: fieldKeys.all(workspaceId) });
      const previous = qc.getQueryData<CustomField[]>(fieldKeys.all(workspaceId));
      qc.setQueryData<CustomField[]>(fieldKeys.all(workspaceId), (old) => {
        const byId = new Map((old ?? []).map((f) => [f.id, f]));
        return orderedIds.flatMap((id, position) => {
          const f = byId.get(id);
          return f ? [{ ...f, position }] : [];
        });
      });
      return { previous };
    },
    onError: (err, _ids, ctx) => {
      qc.setQueryData(fieldKeys.all(workspaceId), ctx?.previous);
      toast.error(errorMessage(err));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: fieldKeys.all(workspaceId) }),
  });
}

/** How many tasks hold a value for the field; fetched when the delete dialog opens. */
export function useFieldValueCount(fieldId: string | null) {
  const { workspaceId, enabled } = useFieldScope();
  return useQuery({
    queryKey: fieldKeys.count(workspaceId, fieldId ?? ''),
    queryFn: () => countFieldValues(fieldId ?? ''),
    enabled: enabled && !!fieldId,
    staleTime: 0,
    gcTime: 0,
  });
}

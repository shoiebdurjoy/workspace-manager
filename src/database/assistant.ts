import type { Executor, Snapshot } from '@/lib/assistant/engine';
import { getSupabaseClient } from './client';

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

/** Everything the built-in assistant reasons over, read with the signed-in person's session (RLS applies). */
export async function loadAssistantSnapshot(workspaceId: string): Promise<Snapshot> {
  const db = getSupabaseClient();
  const [spaces, folders, lists, members, avail, statuses, tasks] = await Promise.all([
    db.from('spaces').select('id,name').eq('workspace_id', workspaceId).order('position'),
    db.from('folders').select('id,name,space_id,default_qc_id').eq('workspace_id', workspaceId),
    db.from('lists').select('id,name,space_id,folder_id,default_qc_id').eq('workspace_id', workspaceId),
    db.from('workspace_members').select('user_id,role,profiles(full_name,email)').eq('workspace_id', workspaceId),
    db.from('member_availability').select('user_id,status').eq('workspace_id', workspaceId),
    db.from('workflow_statuses').select('key,name,category,position').order('position'),
    db.from('tasks').select('id,title,status,list_id,due_date,task_assignees(role_type,user_id)').eq('workspace_id', workspaceId).limit(10000),
  ]);
  for (const r of [spaces, folders, lists, members, statuses, tasks]) fail(r.error);
  const seen = new Set<string>();
  // the generated types predate migration 26 (default_qc_id), so rows are read loosely here
  type Row = Record<string, unknown>;
  return {
    today: new Date().toISOString().slice(0, 10),
    spaces: (spaces.data ?? []) as { id: string; name: string }[],
    folders: ((folders.data ?? []) as unknown as Row[]).map((f) => ({ id: f.id as string, name: f.name as string, spaceId: f.space_id as string, defaultQcId: (f.default_qc_id as string) ?? null })),
    lists: ((lists.data ?? []) as unknown as Row[]).map((l) => ({
      id: l.id as string,
      name: l.name as string,
      spaceId: l.space_id as string,
      folderId: (l.folder_id as string) ?? null,
      defaultQcId: (l.default_qc_id as string) ?? null,
    })),
    members: ((members.data ?? []) as Row[]).map((m) => {
      const p = m.profiles as { full_name?: string | null; email?: string | null } | null;
      return {
        id: m.user_id as string,
        name: p?.full_name || p?.email || 'Member',
        role: m.role as string,
        availability: ((avail.data ?? []) as Row[]).find((a) => a.user_id === m.user_id)?.status as string | null ?? null,
      };
    }),
    statuses: ((statuses.data ?? []) as Row[])
      .filter((s) => (seen.has(s.key as string) ? false : (seen.add(s.key as string), true)))
      .map((s) => ({ key: s.key as string, name: s.name as string, category: s.category as string })),
    tasks: ((tasks.data ?? []) as Row[]).map((t) => {
      const people = (t.task_assignees as { role_type: string; user_id: string }[]) ?? [];
      return {
        id: t.id as string,
        title: t.title as string,
        status: t.status as string,
        listId: t.list_id as string,
        dueDate: (t.due_date as string) ?? null,
        editorId: people.find((p) => p.role_type === 'EDITOR')?.user_id ?? null,
        qcId: people.find((p) => p.role_type === 'QC_REVIEWER')?.user_id ?? null,
      };
    }),
  };
}

/** The assistant's hands: the same database calls the app's own screens make. */
export function assistantExecutor(workspaceId: string): Executor {
  // loosely typed for the columns added after the generated types (default_qc_id)
  const db = getSupabaseClient() as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    async updateList(id, patch) {
      fail((await db.from('lists').update(patch).eq('id', id)).error);
    },
    async updateFolder(id, patch) {
      fail((await db.from('folders').update(patch).eq('id', id)).error);
    },
    async createList({ spaceId, folderId, name }) {
      const r = await db.from('lists').insert({ space_id: spaceId, folder_id: folderId, name }).select('id').single();
      fail(r.error);
      return (r.data as { id: string }).id;
    },
    async createFolder({ spaceId, name }) {
      const r = await db.from('folders').insert({ space_id: spaceId, name }).select('id').single();
      fail(r.error);
      return (r.data as { id: string }).id;
    },
    async updateTask(id, patch) {
      fail((await db.from('tasks').update(patch).eq('id', id)).error);
    },
    async setAssignee(taskId, role, userId) {
      fail((await getSupabaseClient().rpc('set_task_assignee', { p_task_id: taskId, p_role_type: role, p_user_id: userId as string })).error);
    },
    async transition(taskId, to, note) {
      const r = await getSupabaseClient().rpc('transition_task', {
        p_task_id: taskId,
        p_to: to,
        p_note: note ?? null,
        p_review_link: null,
        p_final_export_link: null,
        p_expected_from: null,
      } as never);
      fail(r.error);
    },
    async setRole(userId, role) {
      fail((await db.from('workspace_members').update({ role }).eq('workspace_id', workspaceId).eq('user_id', userId)).error);
    },
  };
}

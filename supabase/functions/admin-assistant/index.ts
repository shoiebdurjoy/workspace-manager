// TBB admin assistant: a chat endpoint where an Owner / Admin / Production Manager asks questions about the workspace
// in plain language or tells it to change something ("move THE CONNECTORS from Zim to Myla", "who has the most
// open videos?", "set Myla as QC on every open Localkicks video").
//
// Safety model: every read and write runs with the CALLER's own Supabase session (their JWT), so row-level security,
// guard triggers and the workflow rules apply exactly as in the app; the assistant can never do more than the person
// asking. Nothing is stored server-side: the browser keeps the conversation. Each change is returned in `actions`.
//
// Secrets: ANTHROPIC_API_KEY (supabase secrets set ANTHROPIC_API_KEY=...). SUPABASE_URL / SUPABASE_ANON_KEY are
// provided by the platform. Optional ASSISTANT_MODEL (default claude-sonnet-5-5).
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const MODEL = Deno.env.get('ASSISTANT_MODEL') ?? 'claude-sonnet-5-5';
const MAX_ROUNDS = 10;
const MANAGERS = ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Json = Record<string, unknown>;
interface Ctx {
  db: SupabaseClient;
  workspaceId: string;
  actions: string[];
}

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

const TOOLS = [
  {
    name: 'get_overview',
    description: 'The workspace structure: spaces, folders and lists (with ids, default QC reviewers and open task counts), members (id, name, role, availability), the workflow statuses in order, and the custom fields. Call this first whenever you need ids or names.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'find_tasks',
    description: 'Find tasks. All filters optional and combined. Returns up to `limit` tasks with list, status, editor, QC reviewer, due date.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'part of the title' },
        list_id: { type: 'string' },
        folder_id: { type: 'string' },
        status: { type: 'string', description: 'status key, e.g. QC_FIRST_APPROVAL' },
        assignee_id: { type: 'string', description: 'editor or QC reviewer user id' },
        open_only: { type: 'boolean' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_task',
    description: 'Everything about one task: fields, links, assignees, custom field values, subtasks.',
    input_schema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
  },
  {
    name: 'create_task',
    description: 'Create a task (video) in a list.',
    input_schema: {
      type: 'object',
      properties: {
        list_id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        aspect_ratio: { type: 'string', description: 'e.g. 9:16' },
      },
      required: ['list_id', 'title'],
    },
  },
  {
    name: 'update_task',
    description: 'Change a task\'s title, brief, priority, due date (YYYY-MM-DD or null), client deadline or links. Only the given fields change.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        due_date: { type: ['string', 'null'] },
        client_deadline: { type: ['string', 'null'] },
        raw_footage_link: { type: ['string', 'null'] },
        project_file_link: { type: ['string', 'null'] },
        review_link: { type: ['string', 'null'] },
        final_export_link: { type: ['string', 'null'] },
        list_id: { type: 'string', description: 'move the task to another list' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'change_status',
    description: 'Move a task to another workflow status. Some moves need a note (revisions), a review link (QC stages) or a final export link (sent to client).',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        to: { type: 'string', description: 'status key' },
        note: { type: 'string' },
        review_link: { type: 'string' },
        final_export_link: { type: 'string' },
      },
      required: ['task_id', 'to'],
    },
  },
  {
    name: 'set_assignee',
    description: 'Set or clear (user_id null) the EDITOR or QC_REVIEWER of one task.',
    input_schema: {
      type: 'object',
      properties: { task_id: { type: 'string' }, role: { type: 'string', enum: ['EDITOR', 'QC_REVIEWER'] }, user_id: { type: ['string', 'null'] } },
      required: ['task_id', 'role', 'user_id'],
    },
  },
  {
    name: 'bulk_set_assignee',
    description: 'Set the EDITOR or QC_REVIEWER on every task of a list or folder (open tasks only unless include_closed). Use for "shift Connectors from Zim to Myla".',
    input_schema: {
      type: 'object',
      properties: {
        list_id: { type: 'string' },
        folder_id: { type: 'string' },
        role: { type: 'string', enum: ['EDITOR', 'QC_REVIEWER'] },
        user_id: { type: ['string', 'null'] },
        include_closed: { type: 'boolean' },
      },
      required: ['role', 'user_id'],
    },
  },
  {
    name: 'save_folder',
    description: 'Create a folder (no folder_id; needs space_id and name) or change one (folder_id plus name and/or default_qc_id; null clears the default).',
    input_schema: {
      type: 'object',
      properties: { folder_id: { type: 'string' }, space_id: { type: 'string' }, name: { type: 'string' }, default_qc_id: { type: ['string', 'null'] } },
    },
  },
  {
    name: 'save_list',
    description: 'Create a list (no list_id; needs space_id and name, optional folder_id) or change one: rename, move to another folder (folder_id, null for none), set its own default QC reviewer.',
    input_schema: {
      type: 'object',
      properties: {
        list_id: { type: 'string' },
        space_id: { type: 'string' },
        name: { type: 'string' },
        folder_id: { type: ['string', 'null'] },
        default_qc_id: { type: ['string', 'null'] },
        description: { type: 'string' },
      },
    },
  },
  {
    name: 'save_custom_field',
    description: 'Create a custom field (no field_id) or rename / change the choices of one. Types: text, url, number, dropdown (needs options), date.',
    input_schema: {
      type: 'object',
      properties: { field_id: { type: 'string' }, name: { type: 'string' }, type: { type: 'string', enum: ['text', 'url', 'number', 'dropdown', 'date'] }, options: { type: 'array', items: { type: 'string' } } },
    },
  },
  {
    name: 'set_field_value',
    description: 'Set (or clear with value null) a custom field on a task. Dates are YYYY-MM-DD.',
    input_schema: {
      type: 'object',
      properties: { task_id: { type: 'string' }, field_id: { type: 'string' }, value: {} },
      required: ['task_id', 'field_id', 'value'],
    },
  },
  {
    name: 'set_member_role',
    description: 'Change a member\'s role (OWNER cannot be given or taken here).',
    input_schema: {
      type: 'object',
      properties: { user_id: { type: 'string' }, role: { type: 'string', enum: ['ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST', 'EDITOR', 'CLIENT_VIEWER'] } },
      required: ['user_id', 'role'],
    },
  },
];

async function overview({ db, workspaceId }: Ctx) {
  const [spaces, folders, lists, members, statuses, fields, open] = await Promise.all([
    db.from('spaces').select('id,name').eq('workspace_id', workspaceId).order('position'),
    db.from('folders').select('id,name,space_id,default_qc_id').eq('workspace_id', workspaceId).order('position'),
    db.from('lists').select('id,name,space_id,folder_id,default_qc_id').eq('workspace_id', workspaceId).order('position'),
    db.from('workspace_members').select('user_id,role,profiles(full_name,email)').eq('workspace_id', workspaceId),
    db.from('workflow_statuses').select('key,name,category,position').order('position'),
    db.from('custom_fields').select('id,name,field_type,options').eq('workspace_id', workspaceId).order('position'),
    db.from('tasks').select('list_id,status').eq('workspace_id', workspaceId).not('status', 'eq', 'CLOSED'),
  ]);
  for (const r of [spaces, folders, lists, members, statuses, fields, open]) fail(r.error);
  const avail = await db.from('member_availability').select('user_id,status').eq('workspace_id', workspaceId);
  const counts = new Map<string, number>();
  for (const t of open.data ?? []) counts.set(t.list_id, (counts.get(t.list_id) ?? 0) + 1);
  const seen = new Set<string>();
  return {
    spaces: spaces.data,
    folders: folders.data,
    lists: (lists.data ?? []).map((l) => ({ ...l, open_tasks: counts.get(l.id) ?? 0 })),
    members: (members.data ?? []).map((m: Json) => {
      const p = m.profiles as Json | null;
      return { id: m.user_id, name: p?.full_name ?? p?.email, role: m.role, availability: (avail.data ?? []).find((a) => a.user_id === m.user_id)?.status ?? null };
    }),
    statuses: (statuses.data ?? []).filter((s) => (seen.has(s.key) ? false : (seen.add(s.key), true))),
    custom_fields: fields.data,
  };
}

async function findTasks({ db, workspaceId }: Ctx, a: Json) {
  let q = db
    .from('tasks')
    .select('id,title,status,priority,due_date,client_deadline,list_id,lists(name,folder_id),task_assignees(role_type,user_id)')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(Math.min(Number(a.limit ?? 50), 200));
  if (a.text) q = q.ilike('title', `%${String(a.text)}%`);
  if (a.list_id) q = q.eq('list_id', a.list_id as string);
  if (a.status) q = q.eq('status', a.status as string);
  if (a.open_only) q = q.not('status', 'eq', 'CLOSED');
  if (a.folder_id) {
    const ls = await db.from('lists').select('id').eq('folder_id', a.folder_id as string);
    fail(ls.error);
    q = q.in('list_id', (ls.data ?? []).map((l) => l.id));
  }
  const { data, error } = await q;
  fail(error);
  let rows = data ?? [];
  if (a.assignee_id) rows = rows.filter((t: Json) => (t.task_assignees as Json[]).some((x) => x.user_id === a.assignee_id));
  return rows;
}

async function bulkAssign(ctx: Ctx, a: Json) {
  if (!a.list_id && !a.folder_id) throw new Error('give a list_id or a folder_id');
  const tasks = await findTasks(ctx, { list_id: a.list_id, folder_id: a.folder_id, open_only: !a.include_closed, limit: 200 });
  let changed = 0;
  const failed: string[] = [];
  for (const t of tasks as Json[]) {
    const { error } = await ctx.db.rpc('set_task_assignee', { p_task_id: t.id, p_role_type: a.role, p_user_id: a.user_id });
    if (error) failed.push(`${t.title}: ${error.message}`);
    else changed += 1;
  }
  ctx.actions.push(`Set ${a.role === 'EDITOR' ? 'editor' : 'QC reviewer'} on ${changed} task(s)`);
  return { changed, failed };
}

async function runTool(ctx: Ctx, name: string, a: Json): Promise<unknown> {
  const { db, workspaceId } = ctx;
  switch (name) {
    case 'get_overview':
      return overview(ctx);
    case 'find_tasks':
      return findTasks(ctx, a);
    case 'get_task': {
      const { data, error } = await db
        .from('tasks')
        .select('*,lists(name),task_assignees(role_type,user_id),custom_field_values(field_id,value),subtasks(*)')
        .eq('id', a.task_id as string)
        .single();
      fail(error);
      return data;
    }
    case 'create_task': {
      const { data, error } = await db.rpc('create_task', {
        p_list_id: a.list_id,
        p_title: a.title,
        p_description: a.description ?? null,
        p_priority: a.priority ?? 'MEDIUM',
        p_aspect_ratio: a.aspect_ratio ?? null,
      });
      fail(error);
      ctx.actions.push(`Created task "${a.title}"`);
      return data;
    }
    case 'update_task': {
      const { task_id, ...patch } = a;
      const { error } = await db.from('tasks').update(patch).eq('id', task_id as string);
      fail(error);
      ctx.actions.push(`Updated task (${Object.keys(patch).join(', ')})`);
      return { ok: true };
    }
    case 'change_status': {
      const { data, error } = await db.rpc('transition_task', {
        p_task_id: a.task_id,
        p_to: a.to,
        p_note: a.note ?? null,
        p_review_link: a.review_link ?? null,
        p_final_export_link: a.final_export_link ?? null,
        p_expected_from: null,
      });
      fail(error);
      ctx.actions.push(`Moved a task to ${a.to}`);
      return data;
    }
    case 'set_assignee': {
      const { error } = await db.rpc('set_task_assignee', { p_task_id: a.task_id, p_role_type: a.role, p_user_id: a.user_id });
      fail(error);
      ctx.actions.push(`${a.user_id ? 'Set' : 'Cleared'} the ${a.role === 'EDITOR' ? 'editor' : 'QC reviewer'} of a task`);
      return { ok: true };
    }
    case 'bulk_set_assignee':
      return bulkAssign(ctx, a);
    case 'save_folder': {
      if (a.folder_id) {
        const patch: Json = {};
        if (a.name !== undefined) patch.name = a.name;
        if (a.default_qc_id !== undefined) patch.default_qc_id = a.default_qc_id;
        const { error } = await db.from('folders').update(patch).eq('id', a.folder_id as string);
        fail(error);
        ctx.actions.push(`Updated folder (${Object.keys(patch).join(', ')})`);
        return { ok: true };
      }
      const { data, error } = await db.from('folders').insert({ space_id: a.space_id, name: a.name, default_qc_id: a.default_qc_id ?? null }).select('id').single();
      fail(error);
      ctx.actions.push(`Created folder "${a.name}"`);
      return data;
    }
    case 'save_list': {
      if (a.list_id) {
        const patch: Json = {};
        for (const k of ['name', 'folder_id', 'default_qc_id', 'description']) if (a[k] !== undefined) patch[k] = a[k];
        const { error } = await db.from('lists').update(patch).eq('id', a.list_id as string);
        fail(error);
        ctx.actions.push(`Updated list (${Object.keys(patch).join(', ')})`);
        return { ok: true };
      }
      const { data, error } = await db
        .from('lists')
        .insert({ space_id: a.space_id, name: a.name, folder_id: a.folder_id ?? null, default_qc_id: a.default_qc_id ?? null, description: a.description ?? null })
        .select('id')
        .single();
      fail(error);
      ctx.actions.push(`Created list "${a.name}"`);
      return data;
    }
    case 'save_custom_field': {
      if (a.field_id) {
        const patch: Json = {};
        if (a.name !== undefined) patch.name = a.name;
        if (a.options !== undefined) patch.options = a.options;
        const { error } = await db.from('custom_fields').update(patch).eq('id', a.field_id as string);
        fail(error);
        ctx.actions.push('Updated a custom field');
        return { ok: true };
      }
      const { data, error } = await db
        .from('custom_fields')
        .insert({ workspace_id: workspaceId, name: a.name, field_type: a.type, options: a.type === 'dropdown' ? a.options : null })
        .select('id')
        .single();
      fail(error);
      ctx.actions.push(`Created custom field "${a.name}"`);
      return data;
    }
    case 'set_field_value': {
      if (a.value === null || a.value === '') {
        const { error } = await db.from('custom_field_values').delete().eq('task_id', a.task_id as string).eq('field_id', a.field_id as string);
        fail(error);
      } else {
        const { error } = await db.from('custom_field_values').upsert({ task_id: a.task_id, field_id: a.field_id, value: a.value }, { onConflict: 'task_id,field_id' });
        fail(error);
      }
      ctx.actions.push('Set a custom field value');
      return { ok: true };
    }
    case 'set_member_role': {
      const { error } = await db.from('workspace_members').update({ role: a.role }).eq('workspace_id', workspaceId).eq('user_id', a.user_id as string);
      fail(error);
      ctx.actions.push(`Changed a member's role to ${a.role}`);
      return { ok: true };
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

const SYSTEM = `You are the assistant inside TBB Workspace, the project manager Think Big Brand uses for short-form video editing.
Structure: spaces > folders > lists > tasks. Each list is one client ("3. THE CONNECTORS"); each task is one video,
which may have batch child videos. Folders group clients by QC reviewer, e.g. "CONTENT PIPELINE - ZIM" is checked by Zim,
"CONTENT PIPELINE - MYLA" by Myla; a folder's default_qc_id is the reviewer auto-assigned when a cut reaches QC.
Workflow statuses go TO BE EDITED > IN EDIT > ASSIGNED > STARTED EDITING > QC- FIRST APPROVAL > QC- REVISION NEEDED >
QC- FINAL APPROVAL > QC- APPROVED (RTD) > SENT TO CLIENT > CLIENT REVISION NEEDED / CLIENT APPROVED > CLOSED, plus PAUSED.

How to work:
- Look things up with tools before answering; never guess ids or numbers. Use get_overview for names and ids.
- When the admin asks for a change, do it with the tools, then say exactly what changed. If a request is ambiguous
  (two clients match, or it would touch many tasks), say what you are about to do and ask one short question first.
- "Shift a client from Zim to Myla" means: move that list into Myla's folder (save_list folder_id) and, for its open
  videos, set Myla as QC reviewer (bulk_set_assignee) unless told otherwise.
- If a tool returns an error, explain it simply (it is usually a permission or workflow rule) and suggest the fix.
- Be brief: short sentences, bullet lists for several items, names not ids.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'The assistant is not set up yet: ANTHROPIC_API_KEY is missing.' }, 503);
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Sign in first.' }, 401);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: who, error: whoError } = await db.auth.getUser();
  if (whoError || !who.user) return json({ error: 'Your session has expired. Sign in again.' }, 401);

  let body: { messages?: { role: 'user' | 'assistant'; content: string }[]; workspaceId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request.' }, 400);
  }
  const membership = await db.from('workspace_members').select('workspace_id,role').eq('user_id', who.user.id);
  const mine = (membership.data ?? []).find((m) => !body.workspaceId || m.workspace_id === body.workspaceId);
  if (!mine || !MANAGERS.includes(mine.role)) return json({ error: 'The assistant is for owners, admins and production managers.' }, 403);

  const history = (body.messages ?? []).slice(-20).filter((m) => typeof m.content === 'string' && m.content.trim());
  if (history.length === 0 || history[history.length - 1].role !== 'user') return json({ error: 'Ask something first.' }, 400);

  const ctx: Ctx = { db, workspaceId: mine.workspace_id, actions: [] };
  // deno-lint-ignore no-explicit-any
  const messages: any[] = history.map((m) => ({ role: m.role, content: m.content }));
  const today = new Date().toISOString().slice(0, 10);

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 2048, system: `${SYSTEM}\nToday is ${today}. The person asking is a ${mine.role}.`, tools: TOOLS, messages }),
    });
    if (!res.ok) return json({ error: `The AI service answered ${res.status}. Try again in a moment.` }, 502);
    const out = await res.json();
    messages.push({ role: 'assistant', content: out.content });
    const calls = (out.content ?? []).filter((c: Json) => c.type === 'tool_use');
    if (out.stop_reason !== 'tool_use' || calls.length === 0) {
      const text = (out.content ?? []).filter((c: Json) => c.type === 'text').map((c: Json) => c.text).join('\n').trim();
      return json({ reply: text || 'Done.', actions: ctx.actions });
    }
    const results = [];
    for (const call of calls) {
      try {
        const result = await runTool(ctx, call.name, (call.input ?? {}) as Json);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result ?? null).slice(0, 60_000) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: call.id, content: e instanceof Error ? e.message : String(e), is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return json({ reply: 'That took too many steps. Try a smaller request.', actions: ctx.actions });
});

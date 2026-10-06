import { describe, it, expect, vi, beforeEach } from 'vitest';

type Err = { code?: string; message: string } | null;
interface Result { data?: unknown; error?: Err; count?: number | null }

const results: Record<string, Result> = {};
const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
const rpcResults: Record<string, Result> = {};

function builder(table: string) {
  const b: Record<string, unknown> = {
    then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null, ...(results[table] ?? { data: [] }) }).then(resolve, reject),
  };
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'range', 'single', 'maybeSingle', 'in']) {
    b[m] = (...args: unknown[]) => {
      calls.push({ table, method: m, args });
      return b;
    };
  }
  return b;
}

vi.mock('../client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => builder(table),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: null, ...(rpcResults[fn] ?? {}) });
    },
  }),
}));

import {
  createSubtask,
  createTask,
  deleteSubtask,
  deleteTask,
  getTask,
  listTasks,
  mapTaskError,
  moveTask,
  setTaskAssignee,
  updateSubtask,
  updateTask,
} from '../tasks';
import { NotFoundError, PermissionDeniedError, ValidationError } from '../errors';

const at = (table: string, method: string) => calls.filter((c) => c.table === table && c.method === method);

const LIST = '55555555-5555-4555-8555-555555555555';
const taskRow = {
  id: 't1', workspace_id: 'w1', list_id: LIST, title: 'Episode 1', description: null, status: 'TODO', priority: 'MEDIUM',
  position: 0, due_date: null, aspect_ratio: null, raw_footage_link: null, project_file_link: null, review_link: null,
  final_export_link: null, client_deadline: null, created_by: 'u1', created_at: 'c', updated_at: 'u',
};

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k];
  for (const k of Object.keys(rpcResults)) delete rpcResults[k];
  calls.length = 0;
  rpcCalls.length = 0;
});

describe('listTasks', () => {
  it('reads one page in display order with assignees and checklist counts embedded (no N+1)', async () => {
    results.tasks = {
      count: 130,
      data: [
        {
          id: 't1', list_id: LIST, title: 'A', status: 'IN_PROGRESS', priority: 'HIGH', position: 0, aspect_ratio: '9:16',
          due_date: 'd', client_deadline: 'cd', created_at: 'c', updated_at: 'u',
          task_assignees: [{ role_type: 'QC_REVIEWER', user_id: 'qc' }, { role_type: 'EDITOR', user_id: 'ed' }],
          subtasks: [{ is_completed: true }, { is_completed: false }, { is_completed: true }],
        },
        {
          id: 't2', list_id: LIST, title: 'B', status: 'TODO', priority: 'LOW', position: 1, aspect_ratio: null,
          due_date: null, client_deadline: null, created_at: 'c', updated_at: 'u', task_assignees: null, subtasks: null,
        },
      ],
    };
    const page = await listTasks(LIST, 1, 50);
    expect(at('tasks', 'eq')[0].args).toEqual(['list_id', LIST]);
    expect(at('tasks', 'order').map((c) => c.args[0])).toEqual(['position', 'created_at', 'id']);
    expect(at('tasks', 'range')[0].args).toEqual([50, 99]);
    const select = String(at('tasks', 'select')[0].args[0]);
    expect(select).toContain('task_assignees(role_type, user_id)');
    expect(select).toContain('subtasks(is_completed)');
    expect(select).not.toMatch(/description|link/); // rows stay small: no brief, no links
    expect(at('tasks', 'select')[0].args[1]).toEqual({ count: 'exact' });
    expect(calls.map((c) => c.table)).toEqual(Array(calls.length).fill('tasks')); // one table, one request
    expect(page.total).toBe(130);
    expect(page.items[0]).toMatchObject({ id: 't1', listId: LIST, status: 'IN_PROGRESS', aspectRatio: '9:16', editorId: 'ed', qcId: 'qc', subtaskTotal: 3, subtaskDone: 2 });
    expect(page.items[1]).toMatchObject({ editorId: null, qcId: null, subtaskTotal: 0, subtaskDone: 0 });
  });

  it('defaults to the first page of 100', async () => {
    results.tasks = { data: [], count: 0 };
    await listTasks(LIST);
    expect(at('tasks', 'range')[0].args).toEqual([0, 99]);
  });

  it('requires a list and surfaces failures as readable errors', async () => {
    await expect(listTasks('')).rejects.toBeInstanceOf(ValidationError);
    results.tasks = { error: { code: '42501', message: 'permission denied' } };
    await expect(listTasks(LIST)).rejects.toBeInstanceOf(PermissionDeniedError);
    results.tasks = { error: { code: '08006', message: 'connection failure' } };
    await expect(listTasks(LIST)).rejects.toThrow(/Failed to load the tasks/);
  });
});

describe('getTask', () => {
  it('returns the task with both assignment slots and subtasks in checklist order, from one request', async () => {
    results.tasks = {
      data: {
        ...taskRow,
        task_assignees: [{ role_type: 'EDITOR', user_id: 'ed' }],
        subtasks: [
          { id: 's2', workspace_id: 'w1', task_id: 't1', title: 'Second', description: null, is_completed: false, position: 1, due_date: null, created_by: null, created_at: 'b', updated_at: 'u' },
          { id: 's1', workspace_id: 'w1', task_id: 't1', title: 'First', description: null, is_completed: true, position: 0, due_date: null, created_by: null, created_at: 'a', updated_at: 'u' },
        ],
      },
    };
    const task = await getTask('t1');
    expect(at('tasks', 'eq')[0].args).toEqual(['id', 't1']);
    expect(String(at('tasks', 'select')[0].args[0])).toContain('subtasks(*)');
    expect(task).toMatchObject({ id: 't1', editorId: 'ed', qcId: null, workspaceId: 'w1', listId: LIST });
    expect(task.subtasks.map((s) => s.title)).toEqual(['First', 'Second']);
    expect(task.subtasks[0]).toMatchObject({ isCompleted: true, taskId: 't1' });
  });

  it('a missing (or invisible) task is NotFound, not a crash', async () => {
    results.tasks = { data: null };
    await expect(getTask('nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(getTask('')).rejects.toBeInstanceOf(ValidationError);
    results.tasks = { error: { code: '42501', message: 'x' } };
    await expect(getTask('t1')).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe('createTask', () => {
  it('creates the task and its assignees in ONE call with trimmed, normalised values', async () => {
    rpcResults.create_task = { data: taskRow };
    const task = await createTask(LIST, {
      title: '  Episode 1  ',
      description: '   ',
      priority: 'HIGH',
      aspectRatio: '9:16',
      rawFootageLink: ' https://drive.google.com/x ',
      reviewLink: '',
      dueDate: '2026-10-10T12:00:00.000Z',
      clientDeadline: null,
      editorId: 'ed',
      qcId: 'qc',
    });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toEqual({
      fn: 'create_task',
      args: {
        p_list_id: LIST,
        p_title: 'Episode 1',
        p_description: null,
        p_priority: 'HIGH',
        p_aspect_ratio: '9:16',
        p_raw_footage_link: 'https://drive.google.com/x',
        p_project_file_link: null,
        p_review_link: null,
        p_final_export_link: null,
        p_due_date: '2026-10-10T12:00:00.000Z',
        p_client_deadline: null,
        p_editor_id: 'ed',
        p_qc_id: 'qc',
      },
    });
    expect(calls).toHaveLength(0); // nothing else is touched: no separate insert, no assignee inserts
    expect(task).toMatchObject({ id: 't1', title: 'Episode 1', listId: LIST, workspaceId: 'w1', priority: 'MEDIUM' });
  });

  it('defaults to a bare, unassigned, normal-priority task', async () => {
    rpcResults.create_task = { data: taskRow };
    await createTask(LIST, { title: 'Quick' });
    expect(rpcCalls[0].args).toMatchObject({ p_priority: 'MEDIUM', p_editor_id: null, p_qc_id: null, p_aspect_ratio: null });
  });

  it.each([
    ['a blank title', { title: '   ' }, /task title/],
    ['a title over 500 characters', { title: 'x'.repeat(501) }, /500 characters/],
    ['a description over 20,000 characters', { title: 'x', description: 'd'.repeat(20001) }, /20,000/],
    ['a javascript: link', { title: 'x', reviewLink: 'javascript:alert(1)' }, /Review link/],
    ['a link without a scheme', { title: 'x', rawFootageLink: 'drive.google.com/x' }, /Raw footage/],
    ['an unknown priority', { title: 'x', priority: 'BLOCKER' as never }, /valid priority/],
    ['an unknown aspect ratio', { title: 'x', aspectRatio: '3:2' as never }, /aspect ratio/],
    ['the same person as editor and QC reviewer', { title: 'x', editorId: 'u', qcId: 'u' }, /different people/],
  ])('rejects %s before any request is sent', async (_name, input, message) => {
    await expect(createTask(LIST, input)).rejects.toThrow(message);
    await expect(createTask(LIST, input)).rejects.toBeInstanceOf(ValidationError);
    expect(rpcCalls).toHaveLength(0);
  });

  it('requires a list id', async () => {
    await expect(createTask('', { title: 'x' })).rejects.toBeInstanceOf(ValidationError);
    expect(rpcCalls).toHaveLength(0);
  });

  it('turns database refusals into readable errors', async () => {
    rpcResults.create_task = { error: { code: '42501', message: 'new row violates row-level security policy for table "tasks"' } };
    const denied = await createTask(LIST, { title: 'x' }).catch((e) => e);
    expect(denied).toBeInstanceOf(PermissionDeniedError);
    expect(denied.message).toBe('You do not have permission to create the task.');
    expect(denied.message).not.toMatch(/row-level/);

    rpcResults.create_task = { error: { code: '23514', message: 'the same person cannot be both the editor and the QC reviewer of a task' } };
    await expect(createTask(LIST, { title: 'x' })).rejects.toThrow('the same person cannot be both the editor and the QC reviewer of a task');

    rpcResults.create_task = { error: { code: '23503', message: 'insert or update violates foreign key constraint' } };
    await expect(createTask(LIST, { title: 'x' })).rejects.toThrow(/no longer exists/);
  });
});

describe('updateTask', () => {
  it('sends only the changed fields (so concurrent edits to different fields never clobber each other)', async () => {
    results.tasks = { data: { ...taskRow, title: 'Renamed' } };
    const task = await updateTask('t1', { title: '  Renamed  ' });
    expect(at('tasks', 'update')[0].args[0]).toEqual({ title: 'Renamed' });
    expect(at('tasks', 'eq')[0].args).toEqual(['id', 't1']);
    expect(task.title).toBe('Renamed');
  });

  it('maps every editable field to its column, and an emptied field becomes NULL', async () => {
    results.tasks = { data: taskRow };
    await updateTask('t1', {
      description: '',
      status: 'IN_QC',
      priority: 'URGENT',
      aspectRatio: null,
      rawFootageLink: '',
      projectFileLink: 'https://x.co/p',
      reviewLink: 'https://x.co/r',
      finalExportLink: ' ',
      dueDate: null,
      clientDeadline: '2026-10-20T12:00:00.000Z',
    });
    expect(at('tasks', 'update')[0].args[0]).toEqual({
      description: null,
      status: 'IN_QC',
      priority: 'URGENT',
      aspect_ratio: null,
      raw_footage_link: null,
      project_file_link: 'https://x.co/p',
      review_link: 'https://x.co/r',
      final_export_link: null,
      due_date: null,
      client_deadline: '2026-10-20T12:00:00.000Z',
    });
  });

  it('never sends columns people may not choose (workspace, list, creator, position)', async () => {
    results.tasks = { data: taskRow };
    await updateTask('t1', { title: 'x', listId: 'other', workspaceId: 'w2', createdBy: 'me', position: 99 } as never);
    expect(Object.keys(at('tasks', 'update')[0].args[0] as object)).toEqual(['title']);
  });

  it('validates before touching the database', async () => {
    await expect(updateTask('t1', { title: ' ' })).rejects.toThrow(/task title/);
    await expect(updateTask('t1', { reviewLink: 'javascript:1' })).rejects.toThrow(/Review link/);
    await expect(updateTask('t1', { status: 'DONE' as never })).rejects.toThrow(/valid status/);
    await expect(updateTask('t1', {})).rejects.toThrow(/nothing to save/);
    await expect(updateTask('', { title: 'x' })).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);
  });

  it('zero rows updated means "not yours or gone": reported as permission denied', async () => {
    results.tasks = { data: null };
    await expect(updateTask('t1', { title: 'x' })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('turns database refusals into readable errors (guard triggers, constraints)', async () => {
    results.tasks = { error: { code: '42501', message: 'editors can only update tasks that are assigned to them' } };
    await expect(updateTask('t1', { status: 'IN_PROGRESS' })).rejects.toBeInstanceOf(PermissionDeniedError);
    results.tasks = { error: { code: '23514', message: 'new row for relation "tasks" violates check constraint "tasks_review_link_url"' } };
    await expect(updateTask('t1', { reviewLink: 'https://a.co' })).rejects.toThrow(/Review link: enter a full link/);
  });
});

describe('deleteTask', () => {
  it('deletes by id and confirms a row was actually removed', async () => {
    results.tasks = { data: [{ id: 't1' }] };
    await deleteTask('t1');
    expect(at('tasks', 'delete')).toHaveLength(1);
    expect(at('tasks', 'eq')[0].args).toEqual(['id', 't1']);
  });

  it('zero rows deleted is a permission failure (RLS hides rows rather than raising)', async () => {
    results.tasks = { data: [] };
    await expect(deleteTask('t1')).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(deleteTask('')).rejects.toBeInstanceOf(ValidationError);
  });

  it('surfaces database errors', async () => {
    results.tasks = { error: { code: '42501', message: 'x' } };
    await expect(deleteTask('t1')).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe('assignment and ordering', () => {
  it('assigns, replaces and clears through one atomic call', async () => {
    await setTaskAssignee('t1', 'EDITOR', 'ed');
    await setTaskAssignee('t1', 'QC_REVIEWER', null);
    expect(rpcCalls).toEqual([
      { fn: 'set_task_assignee', args: { p_task_id: 't1', p_role_type: 'EDITOR', p_user_id: 'ed' } },
      { fn: 'set_task_assignee', args: { p_task_id: 't1', p_role_type: 'QC_REVIEWER', p_user_id: null } },
    ]);
    expect(calls).toHaveLength(0);
    await expect(setTaskAssignee('', 'EDITOR', 'ed')).rejects.toBeInstanceOf(ValidationError);
  });

  it('explains why an assignment is refused', async () => {
    rpcResults.set_task_assignee = { error: { code: '23514', message: 'only QC specialists and managers can be assigned as QC reviewer' } };
    await expect(setTaskAssignee('t1', 'QC_REVIEWER', 'ed')).rejects.toThrow('only QC specialists and managers can be assigned as QC reviewer');
    rpcResults.set_task_assignee = { error: { code: '42501', message: 'you do not have permission to change this assignment' } };
    await expect(setTaskAssignee('t1', 'EDITOR', null)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('moves a task up or down and reports whether anything moved', async () => {
    rpcResults.move_task = { data: true };
    expect(await moveTask('t1', 'down')).toBe(true);
    rpcResults.move_task = { data: false };
    expect(await moveTask('t1', 'up')).toBe(false);
    expect(rpcCalls).toEqual([
      { fn: 'move_task', args: { p_task_id: 't1', p_direction: 'down' } },
      { fn: 'move_task', args: { p_task_id: 't1', p_direction: 'up' } },
    ]);
    await expect(moveTask('', 'up')).rejects.toBeInstanceOf(ValidationError);
  });

  it('a task that disappeared mid-move is NotFound; a role that cannot reorder is denied', async () => {
    rpcResults.move_task = { error: { code: 'P0002', message: 'task not found' } };
    await expect(moveTask('t1', 'up')).rejects.toBeInstanceOf(NotFoundError);
    rpcResults.move_task = { error: { code: '42501', message: 'you do not have permission to reorder these tasks' } };
    await expect(moveTask('t1', 'up')).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe('subtasks', () => {
  const subRow = { id: 's1', workspace_id: 'w1', task_id: 't1', title: 'Rough cut', description: null, is_completed: false, position: 2, due_date: null, created_by: null, created_at: 'c', updated_at: 'u' };

  it('adds a subtask at the given position with a trimmed title', async () => {
    results.subtasks = { data: subRow };
    const sub = await createSubtask('t1', '  Rough cut ', 2);
    expect(at('subtasks', 'insert')[0].args[0]).toEqual({ task_id: 't1', title: 'Rough cut', position: 2 });
    expect(sub).toEqual({ id: 's1', taskId: 't1', title: 'Rough cut', isCompleted: false, position: 2, createdAt: 'c', updatedAt: 'u' });
  });

  it('refuses a blank subtask title and a missing task before any request', async () => {
    await expect(createSubtask('t1', '  ', 0)).rejects.toThrow(/subtask title/);
    await expect(createSubtask('', 'x', 0)).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);
  });

  it('ticks and renames', async () => {
    results.subtasks = { data: { ...subRow, is_completed: true } };
    const sub = await updateSubtask('s1', { isCompleted: true });
    expect(at('subtasks', 'update')[0].args[0]).toEqual({ is_completed: true });
    expect(sub.isCompleted).toBe(true);
    await updateSubtask('s1', { title: ' New ' });
    expect(at('subtasks', 'update')[1].args[0]).toEqual({ title: 'New' });
    await expect(updateSubtask('s1', {})).rejects.toThrow(/nothing to save/);
    await expect(updateSubtask('s1', { title: '' })).rejects.toThrow(/subtask title/);
  });

  it('an editor who is not assigned cannot tick: zero rows / guard error is a permission failure', async () => {
    results.subtasks = { data: null };
    await expect(updateSubtask('s1', { isCompleted: true })).rejects.toBeInstanceOf(PermissionDeniedError);
    results.subtasks = { error: { code: '42501', message: 'editors can only tick subtasks of tasks that are assigned to them' } };
    await expect(updateSubtask('s1', { isCompleted: true })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('deletes and verifies a row went away', async () => {
    results.subtasks = { data: [{ id: 's1' }] };
    await deleteSubtask('s1');
    expect(at('subtasks', 'delete')).toHaveLength(1);
    results.subtasks = { data: [] };
    await expect(deleteSubtask('s1')).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(deleteSubtask('')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('mapTaskError', () => {
  it('names the field for each constraint, hides raw SQL, and passes through trigger messages', () => {
    const cases: Array<[string, RegExp]> = [
      ['tasks_raw_footage_link_url', /Raw footage/],
      ['tasks_project_file_link_url', /Project file/],
      ['tasks_review_link_url', /Review link/],
      ['tasks_final_export_link_url', /Final export/],
      ['tasks_aspect_ratio_valid', /aspect ratio/],
      ['tasks_description_length', /too long/],
      ['tasks_title_check', /task title/],
      ['subtasks_title_check', /subtask title/],
    ];
    for (const [constraint, pattern] of cases) {
      const err = mapTaskError('save', { code: '23514', message: `new row for relation "x" violates check constraint "${constraint}"` });
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.message).toMatch(pattern);
      expect(err.message).not.toMatch(/relation|violates/);
    }
    const unknown = mapTaskError('save', { code: '23514', message: 'violates check constraint "mystery"' });
    expect(unknown.message).toMatch(/not valid/);
    expect(mapTaskError('save', { code: '23514', message: 'only editors and managers can be assigned to edit a video' }).message).toBe('only editors and managers can be assigned to edit a video');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Err = { code?: string; message: string } | null;
interface Result { data?: unknown; error?: Err }

const results: Record<string, Result> = {};
const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
const rpcResults: Record<string, Result> = {};

function builder(table: string) {
  const b: Record<string, unknown> = {
    then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null, ...(results[table] ?? { data: [] }) }).then(resolve, reject),
  };
  for (const m of ['select', 'eq', 'not', 'order', 'limit', 'maybeSingle']) {
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

import { getLatestRevisionRequest, getWorkflow, StaleTransitionError, transitionTask } from '../workflow';
import { NotFoundError, PermissionDeniedError, ValidationError } from '../errors';

const taskRow = {
  id: 't1', workspace_id: 'w1', list_id: 'l1', title: 'Episode 1', description: null, status: 'QC_FIRST_APPROVAL', priority: 'MEDIUM',
  position: 0, due_date: null, aspect_ratio: null, raw_footage_link: null, project_file_link: null, review_link: 'https://frame.io/r',
  final_export_link: null, client_deadline: null, revision_count: 2, created_by: 'u1', created_at: 'c', updated_at: 'u',
};
const statusRow = (key: string, position: number, o: Record<string, unknown> = {}) => ({
  workflow_id: 'wf', key, name: key.replace(/_/g, ' '), category: 'IN_PROGRESS', color: '#000000', position, description: null,
  is_initial: position === 0, requires_editor: false, requires_review_link: false, requires_final_export: false,
  requires_note: false, counts_revision: false, ...o,
});

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k];
  for (const k of Object.keys(rpcResults)) delete rpcResults[k];
  calls.length = 0;
  rpcCalls.length = 0;
});

describe('getWorkflow', () => {
  it("reads the workspace's default workflow with its stages (in order) and moves, in one request", async () => {
    results.workflows = {
      data: {
        id: 'wf',
        name: 'TBB video production',
        workflow_statuses: [statusRow('B', 1, { requires_note: true, counts_revision: true }), statusRow('A', 0)],
        workflow_transitions: [{ workflow_id: 'wf', from_key: 'A', to_key: 'B', label: 'Go', kind: 'forward', roles: ['EDITOR'] }],
      },
    };
    const wf = await getWorkflow('w1');
    expect(calls.filter((c) => c.method === 'eq').map((c) => c.args)).toEqual([['workspace_id', 'w1'], ['is_default', true]]);
    expect(wf.statuses.map((s) => s.key)).toEqual(['A', 'B']);
    expect(wf.statuses[1]).toMatchObject({ requiresNote: true, countsRevision: true, isInitial: false });
    expect(wf.transitions).toEqual([{ from: 'A', to: 'B', label: 'Go', kind: 'forward', roles: ['EDITOR'] }]);
  });

  it('a workspace without a workflow (or one the person cannot see) is "not found"', async () => {
    results.workflows = { data: null };
    await expect(getWorkflow('w1')).rejects.toBeInstanceOf(NotFoundError);
    await expect(getWorkflow('')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('transitionTask', () => {
  it('is one atomic RPC carrying the target, the note, any links and the stage the person saw', async () => {
    rpcResults.transition_task = { data: { ...taskRow, status: 'QC_REVISION_NEEDED', revision_count: 3 } };
    const task = await transitionTask('t1', { to: 'QC_REVISION_NEEDED', note: '  Fix the intro  ', expectedFrom: 'QC_FIRST_APPROVAL' });
    expect(rpcCalls).toEqual([
      {
        fn: 'transition_task',
        args: { p_task_id: 't1', p_to: 'QC_REVISION_NEEDED', p_note: 'Fix the intro', p_review_link: null, p_final_export_link: null, p_expected_from: 'QC_FIRST_APPROVAL' },
      },
    ]);
    expect(task).toMatchObject({ status: 'QC_REVISION_NEEDED', revisionCount: 3 });
  });

  it('validates before calling: a stage, a sane note, safe links', async () => {
    await expect(transitionTask('', { to: 'X' })).rejects.toBeInstanceOf(ValidationError);
    await expect(transitionTask('t1', { to: '' })).rejects.toThrow(/Choose a stage/);
    await expect(transitionTask('t1', { to: 'X', note: 'x'.repeat(2001) })).rejects.toThrow(/2000 characters/);
    await expect(transitionTask('t1', { to: 'X', reviewLink: 'javascript:alert(1)' })).rejects.toThrow(/Review link/);
    await expect(transitionTask('t1', { to: 'X', finalExportLink: 'ftp://x' })).rejects.toThrow(/Final export/);
    expect(rpcCalls).toHaveLength(0);
  });

  it('someone else moved it first: a stale-state error the UI can recognise', async () => {
    rpcResults.transition_task = { error: { code: 'TB409', message: 'task t1 is no longer in QC_FIRST_APPROVAL' } };
    await expect(transitionTask('t1', { to: 'QC_APPROVED_RTD', expectedFrom: 'QC_FIRST_APPROVAL' })).rejects.toBeInstanceOf(StaleTransitionError);
  });

  it("passes the workflow's own explanations through, readably", async () => {
    rpcResults.transition_task = { error: { code: '42501', message: 'your role cannot move a task from QC - FIRST APPROVAL to QC - APPROVED (RTD)' } };
    await expect(transitionTask('t1', { to: 'QC_APPROVED_RTD' })).rejects.toThrow(
      'Your role cannot move a task from QC - FIRST APPROVAL to QC - APPROVED (RTD).'
    );
    rpcResults.transition_task = { error: { code: '23514', message: 'QC - REVISION NEEDED needs a note explaining what to change' } };
    await expect(transitionTask('t1', { to: 'QC_REVISION_NEEDED' })).rejects.toThrow(/^QC - REVISION NEEDED needs a note/);
  });

  it('other refusals map to the usual errors (nothing visible = permission denied)', async () => {
    rpcResults.transition_task = { error: { code: '42501', message: 'permission denied for function transition_task' } };
    await expect(transitionTask('t1', { to: 'X' })).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe('getLatestRevisionRequest', () => {
  it('reads only the newest event that counted a revision', async () => {
    results.task_status_events = {
      data: [{ id: 'e', task_id: 't1', workspace_id: 'w1', from_status: 'QC_FIRST_APPROVAL', to_status: 'QC_REVISION_NEEDED', actor_id: 'qc', note: 'Fix', is_override: false, revision_number: 2, created_at: 'c' }],
    };
    const ev = await getLatestRevisionRequest('t1');
    expect(ev).toMatchObject({ note: 'Fix', revisionNumber: 2, actorId: 'qc', isOverride: false });
    expect(calls.find((c) => c.method === 'not')?.args).toEqual(['revision_number', 'is', null]);
    expect(calls.find((c) => c.method === 'limit')?.args).toEqual([1]);
  });

  it('none yet: null', async () => {
    results.task_status_events = { data: [] };
    expect(await getLatestRevisionRequest('t1')).toBeNull();
  });
});

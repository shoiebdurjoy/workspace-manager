import { beforeEach, describe, expect, it, vi } from 'vitest';

type Err = { code?: string; message: string } | null;
interface Result { data?: unknown; error?: Err }

let tableResult: Result = { data: [] };
let rpcResult: Result = { data: null };
const calls: Array<{ target: string; method: string; args: unknown[] }> = [];

function builder(table: string) {
  const b: Record<string, unknown> = {
    then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null, ...tableResult }).then(resolve, reject),
  };
  for (const m of ['select', 'eq', 'order', 'limit']) {
    b[m] = (...args: unknown[]) => {
      calls.push({ target: table, method: m, args });
      return b;
    };
  }
  return b;
}

vi.mock('../config', () => ({
  getDatabaseConfig: () => ({ supabaseUrl: 'https://proj.supabase.co/', supabaseAnonKey: 'anon-key', isConfigured: true, validationError: null }),
}));
vi.mock('../client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => {
      calls.push({ target: 'rpc', method: fn, args: [args] });
      return Promise.resolve({ data: null, error: null, ...rpcResult });
    },
  }),
}));

import { createBatchVideo, getBatchProgress, listBatchVideos } from '../batches';
import { PermissionDeniedError, ValidationError } from '../errors';

const PARENT = '11111111-1111-4111-8111-111111111111';
const rpc = (fn: string) => calls.filter((c) => c.target === 'rpc' && c.method === fn);

const taskRow = (over: Record<string, unknown> = {}) => ({
  id: 'v1', workspace_id: 'ws', list_id: 'l1', title: 'Video 1', description: null, status: 'TO_BE_EDITED', priority: 'MEDIUM',
  position: 0, aspect_ratio: null, due_date: '2026-10-12T12:00:00Z', client_deadline: null, revision_count: 0,
  raw_footage_link: null, project_file_link: null, review_link: null, final_export_link: null, parent_id: PARENT,
  created_by: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over,
});

beforeEach(() => {
  calls.length = 0;
  tableResult = { data: [] };
  rpcResult = { data: null };
});

describe('listBatchVideos', () => {
  it('reads the videos of a batch with the list projection, in order, and maps editor and QC', async () => {
    tableResult = {
      data: [{
        id: 'v1', list_id: 'l1', title: 'Video 1', status: 'TO_BE_EDITED', priority: 'HIGH', position: 0, aspect_ratio: null,
        due_date: '2026-10-12T12:00:00Z', client_deadline: null, revision_count: 0, raw_footage_link: null, project_file_link: null,
        review_link: null, final_export_link: null, created_at: 'a', updated_at: 'b',
        task_assignees: [{ role_type: 'EDITOR', user_id: 'u-ed' }, { role_type: 'QC_REVIEWER', user_id: 'u-qc' }],
        subtasks: [{ is_completed: true }, { is_completed: false }],
      }],
    };
    const videos = await listBatchVideos(PARENT);
    expect(calls.find((c) => c.method === 'eq')?.args).toEqual(['parent_id', PARENT]);
    expect(calls.some((c) => c.method === 'limit')).toBe(true);
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ id: 'v1', title: 'Video 1', editorId: 'u-ed', qcId: 'u-qc', subtaskTotal: 2, subtaskDone: 1 });
  });

  it('maps a database error and refuses an empty id', async () => {
    tableResult = { error: { code: '42501', message: 'permission denied' } };
    await expect(listBatchVideos(PARENT)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(listBatchVideos('')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('createBatchVideo', () => {
  it('calls create_batch_video with the trimmed title and the people', async () => {
    rpcResult = { data: taskRow() };
    const task = await createBatchVideo(PARENT, '  Video 1  ', 'u-ed', 'u-qc');
    expect(rpc('create_batch_video')[0].args[0]).toEqual({ p_parent_id: PARENT, p_title: 'Video 1', p_editor_id: 'u-ed', p_qc_id: 'u-qc' });
    expect(task).toMatchObject({ id: 'v1', title: 'Video 1' });
  });

  it('sends nulls for missing people', async () => {
    rpcResult = { data: taskRow() };
    await createBatchVideo(PARENT, 'x');
    expect(rpc('create_batch_video')[0].args[0]).toMatchObject({ p_editor_id: null, p_qc_id: null });
  });

  it('refuses a blank title, a long one and the same person twice without calling the database', async () => {
    await expect(createBatchVideo(PARENT, '   ')).rejects.toBeInstanceOf(ValidationError);
    await expect(createBatchVideo(PARENT, 'x'.repeat(501))).rejects.toBeInstanceOf(ValidationError);
    await expect(createBatchVideo(PARENT, 'x', 'u', 'u')).rejects.toBeInstanceOf(ValidationError);
    await expect(createBatchVideo('', 'x')).rejects.toBeInstanceOf(ValidationError);
    expect(rpc('create_batch_video')).toHaveLength(0);
  });

  it('maps a refusal from the database', async () => {
    rpcResult = { error: { code: '42501', message: 'new row violates row-level security policy' } };
    await expect(createBatchVideo(PARENT, 'x')).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe('getBatchProgress', () => {
  it('returns a map by batch, de-duplicating the ids it sends', async () => {
    rpcResult = { data: [{ parent_id: PARENT, total: 10, finished: 3 }] };
    const map = await getBatchProgress([PARENT, PARENT, '']);
    expect(rpc('batch_progress')[0].args[0]).toEqual({ p_parent_ids: [PARENT] });
    expect(map.get(PARENT)).toEqual({ total: 10, finished: 3 });
  });

  it('does not call the database for no ids and refuses more than 500', async () => {
    expect((await getBatchProgress([])).size).toBe(0);
    expect(rpc('batch_progress')).toHaveLength(0);
    await expect(getBatchProgress(Array.from({ length: 501 }, (_, i) => `id-${i}`))).rejects.toBeInstanceOf(ValidationError);
  });
});

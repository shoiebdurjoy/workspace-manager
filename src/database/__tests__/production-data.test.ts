import { describe, it, expect, vi, beforeEach } from 'vitest';

type Err = { code?: string; message: string } | null;
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
const rpcResults: Record<string, { data?: unknown; error?: Err }> = {};

vi.mock('../client', () => ({
  getSupabaseClient: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: null, ...(rpcResults[fn] ?? {}) });
    },
  }),
}));

import { getProductionMonthly, getProductionVideos } from '../production';
import { PermissionDeniedError, ValidationError } from '../errors';

beforeEach(() => {
  rpcCalls.length = 0;
  for (const k of Object.keys(rpcResults)) delete rpcResults[k];
});

describe('getProductionMonthly', () => {
  it('asks the database function for the workspace and time zone, and maps the rows', async () => {
    rpcResults.production_monthly = { data: [{ editor_id: 'e1', year: 2026, month: 10, credits: 24 }] };
    expect(await getProductionMonthly('w1', 'Asia/Dhaka')).toEqual([{ editorId: 'e1', year: 2026, month: 10, credits: 24 }]);
    expect(rpcCalls).toEqual([{ fn: 'production_monthly', args: { p_workspace_id: 'w1', p_timezone: 'Asia/Dhaka' } }]);
  });

  it('no data is an empty list; a missing workspace never reaches the database', async () => {
    expect(await getProductionMonthly('w1')).toEqual([]);
    await expect(getProductionMonthly('')).rejects.toBeInstanceOf(ValidationError);
    expect(rpcCalls).toHaveLength(1);
  });

  it('anyone but Owner / Admin gets a plain permission error', async () => {
    rpcResults.production_monthly = { error: { code: '42501', message: 'only the owner and admins can see production analytics' } };
    await expect(getProductionMonthly('w1')).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(getProductionMonthly('w1')).rejects.toThrow('Only the owner and admins can see production analytics.');
  });
});

describe('getProductionVideos', () => {
  const row = {
    task_id: 't1', title: 'Video X', status: 'CLOSED', first_qc_submitted_at: '2026-10-03T09:00:00Z', submitted_by: 'e1',
    list_id: 'l1', list_name: '25. EDAPTX', folder_name: 'ZIM', space_id: 's1', space_name: 'Content', review_link: 'https://app.frame.io/r/1',
    final_export_link: null, project_file_link: null,
  };

  it('maps the task fields as they are (the task stays the source of truth)', async () => {
    rpcResults.production_videos = { data: [row] };
    const [v] = await getProductionVideos('w1', 'e1', 2026, 10, 'UTC');
    expect(v).toMatchObject({ taskId: 't1', title: 'Video X', status: 'CLOSED', listId: 'l1', spaceId: 's1', reviewLink: 'https://app.frame.io/r/1', folderName: 'ZIM' });
    expect(rpcCalls[0].args).toEqual({ p_workspace_id: 'w1', p_editor_id: 'e1', p_year: 2026, p_month: 10, p_timezone: 'UTC' });
  });

  it('validates before asking', async () => {
    await expect(getProductionVideos('w1', 'e1', 2026, 13)).rejects.toBeInstanceOf(ValidationError);
    await expect(getProductionVideos('w1', 'e1', 2026.5, 3)).rejects.toBeInstanceOf(ValidationError);
    await expect(getProductionVideos('w1', '', 2026, 3)).rejects.toBeInstanceOf(ValidationError);
    expect(rpcCalls).toHaveLength(0);
  });

  it('refusals become plain errors', async () => {
    rpcResults.production_videos = { error: { code: '42501', message: 'x' } };
    await expect(getProductionVideos('w1', 'e1', 2026, 3)).rejects.toBeInstanceOf(PermissionDeniedError);
    rpcResults.production_videos = { error: { code: '22023', message: 'unknown time zone' } };
    await expect(getProductionVideos('w1', 'e1', 2026, 3, 'Nope/Zone')).rejects.toBeInstanceOf(ValidationError);
  });
});

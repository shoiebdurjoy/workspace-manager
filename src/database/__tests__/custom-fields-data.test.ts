import { beforeEach, describe, expect, it, vi } from 'vitest';

type Err = { code?: string; message: string } | null;
interface Result { data?: unknown; error?: Err; count?: number | null }

const results: Record<string, Result> = {};
const calls: Array<{ table: string; method: string; args: unknown[] }> = [];

function builder(table: string) {
  const b: Record<string, unknown> = {
    then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null, ...(results[table] ?? { data: [] }) }).then(resolve, reject),
  };
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit', 'single']) {
    b[m] = (...args: unknown[]) => {
      calls.push({ table, method: m, args });
      return b;
    };
  }
  return b;
}

vi.mock('../config', () => ({
  getDatabaseConfig: () => ({ supabaseUrl: 'https://proj.supabase.co/', supabaseAnonKey: 'anon-key', isConfigured: true, validationError: null }),
}));
vi.mock('../client', () => ({ getSupabaseClient: () => ({ from: (table: string) => builder(table) }) }));

import {
  countFieldValues,
  createCustomField,
  deleteCustomField,
  listCustomFields,
  listTaskFieldValues,
  mapCustomFieldRow,
  reorderCustomFields,
  setTaskFieldValue,
  updateCustomField,
} from '../customFields';
import { PermissionDeniedError, ValidationError, DatabaseError } from '../errors';

const at = (table: string, method: string) => calls.filter((c) => c.table === table && c.method === method);
const WS = '33333333-3333-4333-8333-333333333333';
const TASK = '44444444-4444-4444-8444-444444444444';
const FIELD = '55555555-5555-4555-8555-555555555555';

const row = (over: Record<string, unknown> = {}) => ({
  id: FIELD, workspace_id: WS, name: 'Video Format Needed', field_type: 'dropdown', options: ['16:9', '9:16'], position: 2,
  created_by: 'u1', created_at: '2026-10-05T10:00:00Z', updated_at: '2026-10-05T10:00:00Z', ...over,
});

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k];
  calls.length = 0;
});

describe('definitions', () => {
  it('maps a row, and only dropdowns carry options', () => {
    expect(mapCustomFieldRow(row() as never)).toMatchObject({ id: FIELD, workspaceId: WS, type: 'dropdown', options: ['16:9', '9:16'], position: 2 });
    expect(mapCustomFieldRow(row({ field_type: 'text', options: null }) as never).options).toBeNull();
    expect(mapCustomFieldRow(row({ options: 'junk' }) as never).options).toBeNull();
  });

  it('lists the fields of a workspace in order', async () => {
    results.custom_fields = { data: [row()] };
    const list = await listCustomFields(WS);
    expect(list).toHaveLength(1);
    expect(at('custom_fields', 'eq')[0].args).toEqual(['workspace_id', WS]);
    expect(at('custom_fields', 'order')[0].args).toEqual(['position', { ascending: true }]);
    await expect(listCustomFields('')).rejects.toBeInstanceOf(ValidationError);
  });

  it('creates a field (trimmed name, options only for dropdowns)', async () => {
    results.custom_fields = { data: row() };
    await createCustomField(WS, { name: ' Video Format Needed ', type: 'dropdown', options: ['16:9', '9:16'], position: 2 });
    expect(at('custom_fields', 'insert')[0].args[0]).toEqual({
      workspace_id: WS, name: 'Video Format Needed', field_type: 'dropdown', options: ['16:9', '9:16'], position: 2,
    });
    results.custom_fields = { data: row({ field_type: 'text', options: null }) };
    await createCustomField(WS, { name: 'Note', type: 'text', options: ['ignored'] });
    expect(at('custom_fields', 'insert')[1].args[0]).toMatchObject({ field_type: 'text', options: null });
  });

  it('refuses bad input before any request', async () => {
    await expect(createCustomField(WS, { name: ' ', type: 'text' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createCustomField(WS, { name: 'A', type: 'dropdown', options: [] })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateCustomField(FIELD, { options: ['a', 'a'] })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateCustomField('', { name: 'x' })).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);
  });

  it('updates name, choices and position (never the type)', async () => {
    results.custom_fields = { data: row() };
    await updateCustomField(FIELD, { name: ' New ', options: ['a'], position: 1 });
    expect(at('custom_fields', 'update')[0].args[0]).toEqual({ name: 'New', options: ['a'], position: 1 });
  });

  it('maps database errors', async () => {
    results.custom_fields = { error: { code: '42501', message: 'denied' } };
    await expect(createCustomField(WS, { name: 'A', type: 'text' })).rejects.toBeInstanceOf(PermissionDeniedError);
    results.custom_fields = { error: { code: '23505', message: 'dup' } };
    await expect(updateCustomField(FIELD, { name: 'A' })).rejects.toBeInstanceOf(ValidationError);
    results.custom_fields = { error: { code: '23514', message: 'a workspace can have at most 50 custom fields' } };
    await expect(createCustomField(WS, { name: 'A', type: 'text' })).rejects.toThrow(/at most 50/);
    results.custom_fields = { error: { code: 'XX000', message: 'boom' } };
    await expect(deleteCustomField(FIELD)).rejects.toBeInstanceOf(DatabaseError);
  });

  it('deletes and reorders', async () => {
    await deleteCustomField(FIELD);
    expect(at('custom_fields', 'delete')).toHaveLength(1);
    await reorderCustomFields(['a', 'b', 'c']);
    expect(at('custom_fields', 'update').map((c) => c.args[0])).toEqual([{ position: 0 }, { position: 1 }, { position: 2 }]);
    await expect(deleteCustomField('')).rejects.toBeInstanceOf(ValidationError);
  });

  it('counts the values of a field', async () => {
    results.custom_field_values = { data: null, count: 7 };
    expect(await countFieldValues(FIELD)).toBe(7);
    results.custom_field_values = { data: null, count: null };
    expect(await countFieldValues(FIELD)).toBe(0);
  });
});

describe('values', () => {
  it('reads the values of a task as a map, skipping malformed ones', async () => {
    results.custom_field_values = { data: [{ field_id: 'f1', value: 'x' }, { field_id: 'f2', value: 4 }, { field_id: 'f3', value: { a: 1 } }] };
    const map = await listTaskFieldValues(TASK);
    expect([...map.entries()]).toEqual([['f1', 'x'], ['f2', 4]]);
    expect(at('custom_field_values', 'eq')[0].args).toEqual(['task_id', TASK]);
    await expect(listTaskFieldValues('')).rejects.toBeInstanceOf(ValidationError);
  });

  it('updates an existing value without inserting', async () => {
    results.custom_field_values = { data: [{ field_id: FIELD }] };
    await setTaskFieldValue(TASK, FIELD, 'hello');
    expect(at('custom_field_values', 'update')[0].args[0]).toEqual({ value: 'hello' });
    expect(at('custom_field_values', 'insert')).toHaveLength(0);
  });

  it('inserts when there is no row yet', async () => {
    results.custom_field_values = { data: [] };
    await setTaskFieldValue(TASK, FIELD, 12);
    expect(at('custom_field_values', 'insert')[0].args[0]).toEqual({ task_id: TASK, field_id: FIELD, value: 12 });
  });

  it('a null or empty value deletes the row', async () => {
    await setTaskFieldValue(TASK, FIELD, null);
    await setTaskFieldValue(TASK, FIELD, '');
    expect(at('custom_field_values', 'delete')).toHaveLength(2);
    expect(at('custom_field_values', 'insert')).toHaveLength(0);
    expect(at('custom_field_values', 'update')).toHaveLength(0);
  });

  it('maps refusals', async () => {
    results.custom_field_values = { error: { code: '42501', message: 'rls' } };
    await expect(setTaskFieldValue(TASK, FIELD, 'x')).rejects.toBeInstanceOf(PermissionDeniedError);
    results.custom_field_values = { error: { code: '23514', message: 'Video Format Needed must be one of its choices' } };
    await expect(setTaskFieldValue(TASK, FIELD, 'x')).rejects.toThrow(/one of its choices/);
    await expect(setTaskFieldValue('', FIELD, 'x')).rejects.toBeInstanceOf(ValidationError);
  });
});

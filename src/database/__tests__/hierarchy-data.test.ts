import { describe, it, expect, vi, beforeEach } from 'vitest';

type Err = { code?: string; message: string } | null;
interface Result { data?: unknown; error?: Err }

// A per-call script: each from()/rpc() call pops the next result for that table.
const results: Record<string, Result[]> = {};
const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
const rpcCalls: Array<{ fn: string; args: unknown }> = [];
let rpcResult: Result = { data: 0, error: null };

function next(table: string): Result {
  const queue = results[table] ?? [];
  return queue.length > 1 ? (queue.shift() as Result) : (queue[0] ?? { data: [], error: null });
}

function builder(table: string) {
  const b: Record<string, unknown> = {
    then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null, ...next(table) }).then(resolve, reject),
  };
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'single', 'maybeSingle', 'in']) {
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
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: null, ...rpcResult });
    },
  }),
}));

import { createSpace, deleteSpace, updateSpace } from '../spaces';
import { createFolder, deleteFolder, updateFolder } from '../folders';
import { createList, deleteList, updateList } from '../lists';
import { getWorkspaceHierarchy, reorderHierarchy } from '../hierarchy';
import { PermissionDeniedError, ValidationError } from '../errors';

const at = (table: string, method: string) => calls.filter((c) => c.table === table && c.method === method);

const spaceRow = {
  id: 's1', workspace_id: 'w1', name: 'Content', slug: 'content', description: null, icon: 'folder',
  color: '#F25B4A', is_private: false, position: 0, created_at: 'c', updated_at: 'u',
};
const folderRow = {
  id: 'f1', workspace_id: 'w1', space_id: 's1', name: 'Zim', description: null, position: 0,
  is_collapsed_default: false, created_at: 'c', updated_at: 'u',
};
const listRow = {
  id: 'l1', workspace_id: 'w1', space_id: 's1', folder_id: 'f1', name: 'EDAPTX', description: null,
  color: '#F25B4A', position: 0, created_at: 'c', updated_at: 'u',
};

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k];
  calls.length = 0;
  rpcCalls.length = 0;
  rpcResult = { data: 0, error: null };
});

describe('spaces', () => {
  it('creates a space with a generated slug, defaults and the given position', async () => {
    results.spaces = [{ data: spaceRow }];
    const space = await createSpace({ workspaceId: 'w1', name: '  Content Pipelines ', position: 3 });
    expect(at('spaces', 'insert')[0].args[0]).toEqual({
      workspace_id: 'w1', name: 'Content Pipelines', slug: 'content-pipelines', description: null,
      icon: 'folder', color: '#F25B4A', position: 3,
    });
    expect(space).toMatchObject({ id: 's1', workspaceId: 'w1', name: 'Content', isPrivate: false });
  });

  it('retries with a suffix when the slug is already taken', async () => {
    results.spaces = [{ error: { code: '23505', message: 'dup' } }, { data: spaceRow }];
    await createSpace({ workspaceId: 'w1', name: 'Content', position: 0 });
    const slugs = at('spaces', 'insert').map((c) => (c.args[0] as { slug: string }).slug);
    expect(slugs).toHaveLength(2);
    expect(slugs[0]).toBe('content');
    expect(slugs[1]).toMatch(/^content-[a-z0-9]{1,4}$/);
  });

  it('gives up after repeated slug clashes with a clear message', async () => {
    results.spaces = [{ error: { code: '23505', message: 'dup' } }];
    await expect(createSpace({ workspaceId: 'w1', name: 'Content', position: 0 })).rejects.toThrow(/unique address/);
    expect(at('spaces', 'insert')).toHaveLength(4);
  });

  it('validates input before any request', async () => {
    await expect(createSpace({ workspaceId: '', name: 'x', position: 0 })).rejects.toThrow('Workspace ID is required.');
    await expect(createSpace({ workspaceId: 'w1', name: '  ', position: 0 })).rejects.toThrow('Enter a space name.');
    await expect(createSpace({ workspaceId: 'w1', name: 'x', color: 'red', position: 0 })).rejects.toThrow('Choose a valid color.');
    await expect(createSpace({ workspaceId: 'w1', name: 'x', icon: 'Bad Icon', position: 0 })).rejects.toThrow('Choose a valid icon.');
    await expect(createSpace({ workspaceId: 'w1', name: 'x', description: 'd'.repeat(2001), position: 0 })).rejects.toThrow(/2000/);
    expect(calls).toHaveLength(0);
  });

  it('maps a database refusal to a permission error', async () => {
    results.spaces = [{ error: { code: '42501', message: 'new row violates row-level security policy' } }];
    await expect(createSpace({ workspaceId: 'w1', name: 'x', position: 0 })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('updates only the provided fields', async () => {
    results.spaces = [{ data: spaceRow }];
    await updateSpace('s1', { name: ' New ', description: ' d ', icon: 'rocket', color: '#22C55E' });
    expect(at('spaces', 'update')[0].args[0]).toEqual({ name: 'New', description: 'd', icon: 'rocket', color: '#22C55E' });
    calls.length = 0;
    await updateSpace('s1', { description: null });
    expect(at('spaces', 'update')[0].args[0]).toEqual({ description: null });
  });

  it('zero rows updated means the caller has no permission (RLS hides the row)', async () => {
    results.spaces = [{ data: null }];
    await expect(updateSpace('s1', { name: 'x' })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(updateSpace('', { name: 'x' })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateSpace('s1', { name: '' })).rejects.toThrow('Enter a space name.');
  });

  it('deletes, and treats zero deleted rows as a permission failure', async () => {
    results.spaces = [{ data: [{ id: 's1' }] }];
    await expect(deleteSpace('s1')).resolves.toBeUndefined();
    results.spaces = [{ data: [] }];
    await expect(deleteSpace('s1')).rejects.toBeInstanceOf(PermissionDeniedError);
    results.spaces = [{ error: { code: '42501', message: 'x' } }];
    await expect(deleteSpace('s1')).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(deleteSpace('')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('folders', () => {
  it('creates a folder in a space at the given position', async () => {
    results.folders = [{ data: folderRow }];
    const folder = await createFolder({ spaceId: 's1', name: ' Zim ', description: ' pod ', position: 2 });
    expect(at('folders', 'insert')[0].args[0]).toEqual({ space_id: 's1', name: 'Zim', description: 'pod', position: 2 });
    expect(folder).toMatchObject({ id: 'f1', spaceId: 's1', name: 'Zim' });
  });

  it('validates input and maps errors', async () => {
    await expect(createFolder({ spaceId: '', name: 'x', position: 0 })).rejects.toThrow('Space ID is required.');
    await expect(createFolder({ spaceId: 's1', name: ' ', position: 0 })).rejects.toThrow('Enter a folder name.');
    expect(calls).toHaveLength(0);
    results.folders = [{ error: { code: '42501', message: 'rls' } }];
    await expect(createFolder({ spaceId: 's1', name: 'x', position: 0 })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('renames and treats zero rows as no permission', async () => {
    results.folders = [{ data: folderRow }];
    await updateFolder('f1', { name: ' New ' });
    expect(at('folders', 'update')[0].args[0]).toEqual({ name: 'New' });
    results.folders = [{ data: null }];
    await expect(updateFolder('f1', { name: 'x' })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(updateFolder('', {})).rejects.toBeInstanceOf(ValidationError);
  });

  it('a folder that still holds lists cannot be deleted and the message says what to do', async () => {
    results.folders = [{ error: { code: '23503', message: 'update or delete on table "folders" violates foreign key constraint' } }];
    const err = await deleteFolder('f1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toBe('This folder still contains lists. Move or delete its lists first.');
  });

  it('deletes an empty folder; zero rows means no permission', async () => {
    results.folders = [{ data: [{ id: 'f1' }] }];
    await expect(deleteFolder('f1')).resolves.toBeUndefined();
    results.folders = [{ data: [] }];
    await expect(deleteFolder('f1')).rejects.toBeInstanceOf(PermissionDeniedError);
    results.folders = [{ error: { code: '42501', message: 'x' } }];
    await expect(deleteFolder('f1')).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(deleteFolder('')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('lists', () => {
  it('creates a list directly in a space or inside a folder', async () => {
    results.lists = [{ data: listRow }];
    await createList({ spaceId: 's1', name: 'EDAPTX', position: 0 });
    expect(at('lists', 'insert')[0].args[0]).toMatchObject({ space_id: 's1', folder_id: null, color: '#F25B4A', position: 0 });
    calls.length = 0;
    await createList({ spaceId: 's1', folderId: 'f1', name: 'EDAPTX', color: '#22C55E', description: ' d ', position: 4 });
    expect(at('lists', 'insert')[0].args[0]).toEqual({
      space_id: 's1', folder_id: 'f1', name: 'EDAPTX', description: 'd', color: '#22C55E', position: 4,
    });
  });

  it('validates input', async () => {
    await expect(createList({ spaceId: '', name: 'x', position: 0 })).rejects.toThrow('Space ID is required.');
    await expect(createList({ spaceId: 's1', name: '', position: 0 })).rejects.toThrow('Enter a list name.');
    await expect(createList({ spaceId: 's1', name: 'x', color: 'blue', position: 0 })).rejects.toThrow('Choose a valid color.');
    await expect(createList({ spaceId: 's1', name: 'x', description: 'd'.repeat(2001), position: 0 })).rejects.toThrow(/2000/);
    expect(calls).toHaveLength(0);
  });

  it('a folder from another space is reported in plain language', async () => {
    results.lists = [{ error: { code: '23503', message: 'insert or update on table "lists" violates foreign key constraint "lists_folder_space_fkey"' } }];
    await expect(createList({ spaceId: 's1', folderId: 'foreign', name: 'x', position: 0 })).rejects.toThrow('That folder does not belong to this space.');
    results.lists = [{ error: { code: '23503', message: 'fk' } }];
    await expect(updateList('l1', { folderId: 'foreign' })).rejects.toThrow('That folder does not belong to this space.');
  });

  it('maps permission errors on create', async () => {
    results.lists = [{ error: { code: '42501', message: 'rls' } }];
    await expect(createList({ spaceId: 's1', name: 'x', position: 0 })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('updates name, color, description, folder and position', async () => {
    results.lists = [{ data: listRow }];
    await updateList('l1', { name: ' N ', color: '#EF4444', description: ' d ', folderId: null, position: 7 });
    expect(at('lists', 'update')[0].args[0]).toEqual({ name: 'N', color: '#EF4444', description: 'd', folder_id: null, position: 7 });
    results.lists = [{ data: null }];
    await expect(updateList('l1', { name: 'x' })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(updateList('', {})).rejects.toBeInstanceOf(ValidationError);
  });

  it('deletes; zero rows means no permission', async () => {
    results.lists = [{ data: [{ id: 'l1' }] }];
    await expect(deleteList('l1')).resolves.toBeUndefined();
    results.lists = [{ data: [] }];
    await expect(deleteList('l1')).rejects.toBeInstanceOf(PermissionDeniedError);
    results.lists = [{ error: { code: '42501', message: 'x' } }];
    await expect(deleteList('l1')).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(deleteList('')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('getWorkspaceHierarchy', () => {
  it('loads the tree with three workspace-filtered queries and assembles it', async () => {
    results.spaces = [{ data: [spaceRow] }];
    results.folders = [{ data: [folderRow] }];
    results.lists = [{ data: [listRow, { ...listRow, id: 'l2', name: 'Loose', folder_id: null, position: 1 }] }];
    const tree = await getWorkspaceHierarchy('w1');

    // one query per table, each filtered by the denormalised workspace_id (index-backed), no N+1
    for (const table of ['spaces', 'folders', 'lists']) {
      expect(at(table, 'select')).toHaveLength(1);
      expect(at(table, 'eq')[0].args).toEqual(['workspace_id', 'w1']);
      expect(at(table, 'order')[0].args[0]).toBe('position');
    }
    expect(calls.filter((c) => c.method === 'select')).toHaveLength(3);
    // minimal columns, never select('*')
    for (const c of calls.filter((x) => x.method === 'select')) expect(c.args[0]).not.toBe('*');

    expect(tree).toHaveLength(1);
    expect(tree[0].folders[0].lists.map((l) => l.id)).toEqual(['l1']);
    expect(tree[0].folderlessLists.map((l) => l.id)).toEqual(['l2']);
  });

  it('returns an empty tree for a workspace with nothing in it', async () => {
    results.spaces = [{ data: [] }];
    results.folders = [{ data: [] }];
    results.lists = [{ data: [] }];
    expect(await getWorkspaceHierarchy('w1')).toEqual([]);
  });

  it('requires a workspace and reports which part failed', async () => {
    await expect(getWorkspaceHierarchy('')).rejects.toBeInstanceOf(ValidationError);
    results.spaces = [{ error: { code: '42501', message: 'x' } }];
    results.folders = [{ data: [] }];
    results.lists = [{ data: [] }];
    await expect(getWorkspaceHierarchy('w1')).rejects.toBeInstanceOf(PermissionDeniedError);
    results.spaces = [{ data: [] }];
    results.folders = [{ error: { code: '08006', message: 'connection failure' } }];
    await expect(getWorkspaceHierarchy('w1')).rejects.toThrow(/load folders/);
    results.folders = [{ data: [] }];
    results.lists = [{ error: { code: '08006', message: 'connection failure' } }];
    await expect(getWorkspaceHierarchy('w1')).rejects.toThrow(/load lists/);
  });

  it('treats null result sets as empty', async () => {
    results.spaces = [{ data: null }];
    results.folders = [{ data: null }];
    results.lists = [{ data: null }];
    expect(await getWorkspaceHierarchy('w1')).toEqual([]);
  });
});

describe('reorderHierarchy', () => {
  it('calls the atomic database function with the full sibling order', async () => {
    await reorderHierarchy('folder', ['f2', 'f1']);
    expect(rpcCalls).toEqual([{ fn: 'reorder_hierarchy', args: { kind: 'folder', ids: ['f2', 'f1'] } }]);
  });

  it('does nothing for an empty list and maps refusals to a permission error', async () => {
    await reorderHierarchy('space', []);
    expect(rpcCalls).toHaveLength(0);
    rpcResult = { error: { code: '42501', message: 'you do not have permission to reorder these items' } };
    await expect(reorderHierarchy('space', ['a'])).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

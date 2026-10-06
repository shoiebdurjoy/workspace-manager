import { describe, it, expect } from 'vitest';
import {
  assembleHierarchy,
  breadcrumbFor,
  COLOR_PALETTE,
  countListsInSpace,
  findFolder,
  findList,
  findSpace,
  hierarchyPaths,
  isUuid,
  isValidColor,
  moveWithin,
  nextPosition,
  totalsOf,
  validateDescription,
  validateHierarchyName,
} from '../hierarchy';
import { IDS, makeFolder, makeList, makeSpace, makeTree } from '@/test/hierarchy-fixtures';

describe('validation', () => {
  it('names are required, trimmed and length-limited', () => {
    expect(validateHierarchyName('', 'space')).toBe('Enter a space name.');
    expect(validateHierarchyName('   ', 'folder')).toBe('Enter a folder name.');
    expect(validateHierarchyName('a'.repeat(256), 'list')).toMatch(/255 characters or fewer/);
    expect(validateHierarchyName('  25. EDAPTX  ', 'list')).toBeNull();
    expect(validateHierarchyName('a'.repeat(255), 'list')).toBeNull();
  });

  it('descriptions are length-limited', () => {
    expect(validateDescription('')).toBeNull();
    expect(validateDescription('x'.repeat(2000))).toBeNull();
    expect(validateDescription('x'.repeat(2001))).toMatch(/2000 characters or fewer/);
  });

  it('every palette color satisfies the database constraint', () => {
    for (const c of COLOR_PALETTE) expect(isValidColor(c)).toBe(true);
    expect(isValidColor('red')).toBe(false);
    expect(isValidColor('#12345')).toBe(false);
    expect(isValidColor('#GGGGGG')).toBe(false);
    expect(isValidColor('url(x)')).toBe(false);
  });
});

describe('ordering helpers', () => {
  it('nextPosition appends after the last sibling', () => {
    expect(nextPosition([])).toBe(0);
    expect(nextPosition([{ position: 0 }, { position: 4 }, { position: 2 }])).toBe(5);
  });

  it('moveWithin swaps with the neighbour and refuses impossible moves', () => {
    expect(moveWithin(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(moveWithin(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b']);
    expect(moveWithin(['a', 'b', 'c'], 'a', 'up')).toBeNull();
    expect(moveWithin(['a', 'b', 'c'], 'c', 'down')).toBeNull();
    expect(moveWithin(['a', 'b', 'c'], 'zzz', 'up')).toBeNull();
    const original = ['a', 'b'];
    moveWithin(original, 'a', 'down');
    expect(original).toEqual(['a', 'b']); // never mutates its input
  });
});

describe('assembleHierarchy', () => {
  const space = makeSpace({ id: 's1', name: 'S1' });
  const folderB = makeFolder({ id: 'f2', name: 'B folder', spaceId: 's1', position: 1 });
  const folderA = makeFolder({ id: 'f1', name: 'A folder', spaceId: 's1', position: 0 });

  it('nests lists in their folder and leaves the rest directly in the space', () => {
    const tree = assembleHierarchy(
      [space],
      [folderB, folderA],
      [
        makeList({ id: 'l2', name: 'Second', spaceId: 's1', folderId: 'f1', position: 1 }),
        makeList({ id: 'l1', name: 'First', spaceId: 's1', folderId: 'f1', position: 0 }),
        makeList({ id: 'l3', name: 'Loose', spaceId: 's1', folderId: null }),
      ]
    );
    expect(tree).toHaveLength(1);
    expect(tree[0].folders.map((f) => f.id)).toEqual(['f1', 'f2']); // by position
    expect(tree[0].folders[0].lists.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(tree[0].folderlessLists.map((l) => l.id)).toEqual(['l3']);
  });

  it('sorts by position then name and orders spaces', () => {
    const tree = assembleHierarchy(
      [makeSpace({ id: 'b', name: 'Beta', position: 1 }), makeSpace({ id: 'a2', name: 'Zeta', position: 0 }), makeSpace({ id: 'a1', name: 'Alpha', position: 0 })],
      [],
      []
    );
    expect(tree.map((s) => s.id)).toEqual(['a1', 'a2', 'b']);
  });

  it('a list whose folder is missing or belongs to another space is shown at space level, never lost', () => {
    const tree = assembleHierarchy(
      [space, makeSpace({ id: 's2', name: 'S2' })],
      [makeFolder({ id: 'fx', name: 'X', spaceId: 's2' })],
      [
        makeList({ id: 'orphan', name: 'Orphan', spaceId: 's1', folderId: 'does-not-exist' }),
        makeList({ id: 'wrong', name: 'Wrong', spaceId: 's1', folderId: 'fx' }),
      ]
    );
    expect(tree[0].folderlessLists.map((l) => l.id).sort()).toEqual(['orphan', 'wrong']);
    expect(tree[1].folders[0].lists).toEqual([]);
  });

  it('handles empty input and does not mutate it', () => {
    expect(assembleHierarchy([], [], [])).toEqual([]);
    const inputFolders = [folderA];
    const result = assembleHierarchy([space], inputFolders, [makeList({ id: 'l1', name: 'L', spaceId: 's1', folderId: 'f1' })]);
    expect(result[0].folders[0].lists).toHaveLength(1);
    // the caller's objects are left untouched
    expect(folderA.lists).toHaveLength(0);
    expect(space.folders).toHaveLength(0);
    expect(inputFolders).toEqual([folderA]);
  });
});

describe('lookups', () => {
  const tree = makeTree();

  it('findSpace / findFolder / findList resolve by id and scope to the right parent', () => {
    expect(findSpace(tree, IDS.spaceA)?.name).toBe('Content Pipelines');
    expect(findSpace(tree, IDS.missing)).toBeUndefined();
    expect(findSpace(tree, undefined)).toBeUndefined();
    expect(findFolder(tree, IDS.spaceA, IDS.folderZim)?.folder.name).toBe('CONTENT PIPELINE - ZIM');
    expect(findFolder(tree, IDS.spaceB, IDS.folderZim)).toBeUndefined(); // wrong parent space
    expect(findFolder(tree, IDS.spaceA, undefined)).toBeUndefined();
    const inFolder = findList(tree, IDS.spaceA, IDS.listEdaptx);
    expect(inFolder?.list.name).toBe('25. EDAPTX');
    expect(inFolder?.folder?.id).toBe(IDS.folderZim);
    const loose = findList(tree, IDS.spaceA, IDS.listIntake);
    expect(loose?.folder).toBeNull();
    expect(findList(tree, IDS.spaceB, IDS.listEdaptx)).toBeUndefined(); // wrong parent space
    expect(findList(tree, IDS.spaceA, undefined)).toBeUndefined();
    expect(findList(tree, 'nope', IDS.listEdaptx)).toBeUndefined();
  });

  it('counts lists and totals the tree', () => {
    expect(countListsInSpace(tree[0])).toBe(3);
    expect(countListsInSpace(tree[1])).toBe(0);
    expect(totalsOf(tree)).toEqual({ spaces: 2, folders: 2, lists: 3 });
    expect(totalsOf([])).toEqual({ spaces: 0, folders: 0, lists: 0 });
  });
});

describe('routes and breadcrumbs', () => {
  const tree = makeTree();

  it('spells the canonical URL scheme in one place', () => {
    expect(hierarchyPaths.space('s')).toBe('/spaces/s');
    expect(hierarchyPaths.folder('s', 'f')).toBe('/spaces/s/folders/f');
    expect(hierarchyPaths.list('s', 'l')).toBe('/spaces/s/lists/l');
  });

  it('isUuid accepts UUIDs only', () => {
    expect(isUuid(IDS.spaceA)).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid("1' OR '1'='1")).toBe(false);
  });

  it('builds the trail for a space, a folder and a list (in a folder or not)', () => {
    expect(breadcrumbFor(tree, { spaceId: IDS.spaceA }).map((b) => b.label)).toEqual(['Content Pipelines']);
    expect(breadcrumbFor(tree, { spaceId: IDS.spaceA, folderId: IDS.folderZim }).map((b) => b.label)).toEqual([
      'Content Pipelines',
      'CONTENT PIPELINE - ZIM',
    ]);
    const list = breadcrumbFor(tree, { spaceId: IDS.spaceA, listId: IDS.listEdaptx });
    expect(list.map((b) => b.label)).toEqual(['Content Pipelines', 'CONTENT PIPELINE - ZIM', '25. EDAPTX']);
    expect(list[2].href).toBe(`/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}`);
    expect(breadcrumbFor(tree, { spaceId: IDS.spaceA, listId: IDS.listIntake }).map((b) => b.label)).toEqual([
      'Content Pipelines',
      'Raw Intake',
    ]);
  });

  it('returns nothing for unknown ids or no space', () => {
    expect(breadcrumbFor(tree, {})).toEqual([]);
    expect(breadcrumbFor(tree, { spaceId: IDS.missing })).toEqual([]);
    expect(breadcrumbFor(tree, { spaceId: IDS.spaceA, folderId: IDS.missing }).map((b) => b.label)).toEqual(['Content Pipelines']);
  });
});

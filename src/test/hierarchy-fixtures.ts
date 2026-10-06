import type { HierarchyFolder, HierarchyList, HierarchySpace } from '@/types/database';

/** Test-only fixtures. Valid UUIDs, because routes validate their ids. */
export const IDS = {
  spaceA: '11111111-1111-4111-8111-111111111111',
  spaceB: '22222222-2222-4222-8222-222222222222',
  folderZim: '33333333-3333-4333-8333-333333333333',
  folderMyla: '44444444-4444-4444-8444-444444444444',
  listEdaptx: '55555555-5555-4555-8555-555555555555',
  listConor: '66666666-6666-4666-8666-666666666666',
  listIntake: '77777777-7777-4777-8777-777777777777',
  missing: '99999999-9999-4999-8999-999999999999',
};

const stamp = '2026-10-01T00:00:00Z';

export function makeList(overrides: Partial<HierarchyList> & Pick<HierarchyList, 'id' | 'name' | 'spaceId'>): HierarchyList {
  return {
    folderId: null,
    description: null,
    color: '#7B68EE',
    position: 0,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

export function makeFolder(
  overrides: Partial<HierarchyFolder> & Pick<HierarchyFolder, 'id' | 'name' | 'spaceId'>
): HierarchyFolder {
  return {
    description: null,
    position: 0,
    isCollapsedDefault: false,
    createdAt: stamp,
    updatedAt: stamp,
    lists: [],
    ...overrides,
  };
}

export function makeSpace(
  overrides: Partial<HierarchySpace> & Pick<HierarchySpace, 'id' | 'name'>
): HierarchySpace {
  return {
    workspaceId: 'ws-1',
    slug: overrides.name.toLowerCase().replace(/\s+/g, '-'),
    description: null,
    icon: 'folder',
    color: '#7B68EE',
    isPrivate: false,
    position: 0,
    createdAt: stamp,
    updatedAt: stamp,
    folders: [],
    folderlessLists: [],
    ...overrides,
  };
}

/**
 * Content Pipelines
 *   Zim:   EDAPTX, Conor
 *   Myla:  (empty)
 *   Raw Intake (list directly in the space)
 * Design (empty space)
 */
export function makeTree(): HierarchySpace[] {
  return [
    makeSpace({
      id: IDS.spaceA,
      name: 'Content Pipelines',
      description: 'Client video pipelines',
      icon: 'film',
      color: '#0EA5E9',
      position: 0,
      folders: [
        makeFolder({
          id: IDS.folderZim,
          name: 'CONTENT PIPELINE - ZIM',
          spaceId: IDS.spaceA,
          position: 0,
          lists: [
            makeList({ id: IDS.listEdaptx, name: '25. EDAPTX', spaceId: IDS.spaceA, folderId: IDS.folderZim, position: 0, color: '#22C55E' }),
            makeList({ id: IDS.listConor, name: '2. CONOR CONTENT', spaceId: IDS.spaceA, folderId: IDS.folderZim, position: 1 }),
          ],
        }),
        makeFolder({ id: IDS.folderMyla, name: 'CONTENT PIPELINE - MYLA', spaceId: IDS.spaceA, position: 1 }),
      ],
      folderlessLists: [makeList({ id: IDS.listIntake, name: 'Raw Intake', spaceId: IDS.spaceA, position: 0 })],
    }),
    makeSpace({ id: IDS.spaceB, name: 'Design', position: 1, icon: 'palette', color: '#EC4899' }),
  ];
}

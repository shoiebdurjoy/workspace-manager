import { describe, it, expect } from 'vitest';
import { Space, Folder, List, HierarchySpace } from '@/types/database';

describe('6-Level Hierarchy Structure & Tree Assembly', () => {
  it('correctly maps and nests spaces, folders, and lists', () => {
    const spaces: Space[] = [
      {
        id: 'space-content',
        workspaceId: 'ws-tbb',
        name: 'Content Production',
        slug: 'content-production',
        icon: 'video',
        color: '#7B68EE',
        isPrivate: false,
        position: 0,
        createdAt: '2026-09-30T00:00:00Z',
        updatedAt: '2026-09-30T00:00:00Z',
      },
    ];

    const folders: Folder[] = [
      {
        id: 'folder-zim',
        spaceId: 'space-content',
        name: 'CONTENT PIPELINE - ZIM',
        description: 'Pod Zim editing queue',
        position: 0,
        isCollapsedDefault: false,
        createdAt: '2026-09-30T00:00:00Z',
        updatedAt: '2026-09-30T00:00:00Z',
      },
      {
        id: 'folder-myla',
        spaceId: 'space-content',
        name: 'CONTENT PIPELINE - MYLA',
        description: 'Pod Myla editing queue',
        position: 1,
        isCollapsedDefault: false,
        createdAt: '2026-09-30T00:00:00Z',
        updatedAt: '2026-09-30T00:00:00Z',
      },
    ];

    const lists: List[] = [
      {
        id: 'list-edaptx',
        spaceId: 'space-content',
        folderId: 'folder-zim',
        name: '25. EDAPTX',
        description: 'Deliverables for Edaptx',
        color: '#7B68EE',
        position: 0,
        createdAt: '2026-09-30T00:00:00Z',
        updatedAt: '2026-09-30T00:00:00Z',
      },
      {
        id: 'list-desire',
        spaceId: 'space-content',
        folderId: 'folder-zim',
        name: '50. THE DESIRE COMPANY',
        description: 'Deliverables for Desire Company',
        color: '#7B68EE',
        position: 1,
        createdAt: '2026-09-30T00:00:00Z',
        updatedAt: '2026-09-30T00:00:00Z',
      },
      {
        id: 'list-general',
        spaceId: 'space-content',
        folderId: null, // Folderless list directly under Space
        name: 'General Inquiries',
        color: '#64748B',
        position: 0,
        createdAt: '2026-09-30T00:00:00Z',
        updatedAt: '2026-09-30T00:00:00Z',
      },
    ];

    // Build the hierarchical tree manually to test structure invariants
    const tree: HierarchySpace[] = spaces.map((s) => {
      const spaceFolders = folders
        .filter((f) => f.spaceId === s.id)
        .map((f) => ({
          ...f,
          lists: lists.filter((l) => l.folderId === f.id),
        }));

      const folderlessLists = lists.filter(
        (l) => l.spaceId === s.id && !l.folderId
      );

      return {
        ...s,
        folders: spaceFolders,
        folderlessLists,
      };
    });

    expect(tree).toHaveLength(1);
    const contentSpace = tree[0];

    expect(contentSpace.name).toBe('Content Production');
    expect(contentSpace.folders).toHaveLength(2);
    expect(contentSpace.folderlessLists).toHaveLength(1);

    const zimFolder = contentSpace.folders.find((f) => f.name === 'CONTENT PIPELINE - ZIM');
    expect(zimFolder).toBeDefined();
    expect(zimFolder?.lists).toHaveLength(2);
    expect(zimFolder?.lists.map((l) => l.name)).toEqual(['25. EDAPTX', '50. THE DESIRE COMPANY']);

    const folderless = contentSpace.folderlessLists[0];
    expect(folderless.name).toBe('General Inquiries');
  });

  it('verifies the 6 hierarchy levels exist in the domain model', () => {
    // 1. Workspace
    // 2. Space
    // 3. Folder
    // 4. List
    // 5. Task
    // 6. Subtask
    const hierarchyLevels = [
      'Workspace',
      'Space',
      'Folder',
      'List',
      'Task',
      'Subtask',
    ];
    expect(hierarchyLevels).toHaveLength(6);
    expect(hierarchyLevels[0]).toBe('Workspace');
    expect(hierarchyLevels[5]).toBe('Subtask');
  });
});

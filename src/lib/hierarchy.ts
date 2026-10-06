import type {
  Folder,
  HierarchyFolder,
  HierarchyList,
  HierarchySpace,
  List,
  Space,
} from '@/types/database';
import { DEFAULT_CONTENT_COLOR } from '@/lib/brand';

/**
 * Pure helpers for the Workspace -> Space -> Folder -> List tree. No network, no React:
 * everything here is unit tested and shared by the sidebar, the pages and the dialogs.
 */

export const NAME_MAX_LENGTH = 255;
export const DESCRIPTION_MAX_LENGTH = 2000;
export const DEFAULT_COLOR = DEFAULT_CONTENT_COLOR;

/**
 * Colors a person can give a space, list or pod to tell them apart. These are CONTENT colors
 * (identification), not UI theme colors; the first is the TBB brand coral and the default.
 * All values satisfy the database CHECK `^#[0-9A-Fa-f]{6}$`.
 */
export const COLOR_PALETTE: readonly string[] = [
  DEFAULT_CONTENT_COLOR,
  '#F97316',
  '#EAB308',
  '#22C55E',
  '#14B8A6',
  '#0EA5E9',
  '#3B82F6',
  '#EC4899',
  '#64748B',
  '#292524',
];

export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
export const ICON_SLUG_PATTERN = /^[a-z0-9-]{1,50}$/;

export function isValidColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

export function validateHierarchyName(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `Enter a ${label} name.`;
  if (trimmed.length > NAME_MAX_LENGTH) return `The ${label} name must be ${NAME_MAX_LENGTH} characters or fewer.`;
  return null;
}

export function validateDescription(value: string): string | null {
  if (value.trim().length > DESCRIPTION_MAX_LENGTH) {
    return `The description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}

/** Position for a new sibling: appended after the current last one. */
export function nextPosition(siblings: ReadonlyArray<{ position: number }>): number {
  return siblings.reduce((max, s) => Math.max(max, s.position), -1) + 1;
}

export type MoveDirection = 'up' | 'down';

/**
 * New id order after moving `id` one place up or down inside `orderedIds`.
 * Returns null when the move is impossible (unknown id, already first / last).
 */
export function moveWithin(orderedIds: readonly string[], id: string, direction: MoveDirection): string[] | null {
  const index = orderedIds.indexOf(id);
  if (index === -1) return null;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= orderedIds.length) return null;
  const next = [...orderedIds];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

const byPositionThenName = <T extends { position: number; name: string }>(a: T, b: T) =>
  a.position - b.position || a.name.localeCompare(b.name);

/** Assembles the nested tree from the three flat result sets (already workspace-scoped). */
export function assembleHierarchy(spaces: Space[], folders: Folder[], lists: List[]): HierarchySpace[] {
  const foldersBySpace = new Map<string, HierarchyFolder[]>();
  const folderById = new Map<string, HierarchyFolder>();
  for (const f of folders) {
    const node: HierarchyFolder = { ...f, lists: [] };
    folderById.set(f.id, node);
    foldersBySpace.set(f.spaceId, [...(foldersBySpace.get(f.spaceId) ?? []), node]);
  }

  const folderlessBySpace = new Map<string, HierarchyList[]>();
  for (const l of lists) {
    const node: HierarchyList = { ...l };
    const parent = l.folderId ? folderById.get(l.folderId) : undefined;
    if (parent && parent.spaceId === l.spaceId) {
      parent.lists.push(node);
    } else {
      folderlessBySpace.set(l.spaceId, [...(folderlessBySpace.get(l.spaceId) ?? []), node]);
    }
  }

  return [...spaces].sort(byPositionThenName).map((s) => ({
    ...s,
    folders: (foldersBySpace.get(s.id) ?? []).sort(byPositionThenName).map((f) => ({
      ...f,
      lists: [...f.lists].sort(byPositionThenName),
    })),
    folderlessLists: (folderlessBySpace.get(s.id) ?? []).sort(byPositionThenName),
  }));
}

// ---------------------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------------------

export function findSpace(tree: readonly HierarchySpace[], spaceId: string | undefined): HierarchySpace | undefined {
  return spaceId ? tree.find((s) => s.id === spaceId) : undefined;
}

export function findFolder(
  tree: readonly HierarchySpace[],
  spaceId: string | undefined,
  folderId: string | undefined
): { space: HierarchySpace; folder: HierarchyFolder } | undefined {
  const space = findSpace(tree, spaceId);
  const folder = space?.folders.find((f) => f.id === folderId);
  return space && folder ? { space, folder } : undefined;
}

export function findList(
  tree: readonly HierarchySpace[],
  spaceId: string | undefined,
  listId: string | undefined
): { space: HierarchySpace; folder: HierarchyFolder | null; list: HierarchyList } | undefined {
  const space = findSpace(tree, spaceId);
  if (!space || !listId) return undefined;
  const loose = space.folderlessLists.find((l) => l.id === listId);
  if (loose) return { space, folder: null, list: loose };
  for (const folder of space.folders) {
    const list = folder.lists.find((l) => l.id === listId);
    if (list) return { space, folder, list };
  }
  return undefined;
}

/** Finds a list (and where it lives) from its id alone. */
export function findListById(
  tree: readonly HierarchySpace[],
  listId: string | undefined
): { space: HierarchySpace; folder: HierarchyFolder | null; list: HierarchyList } | undefined {
  if (!listId) return undefined;
  for (const space of tree) {
    const hit = findList(tree, space.id, listId);
    if (hit) return hit;
  }
  return undefined;
}

export function countListsInSpace(space: HierarchySpace): number {
  return space.folderlessLists.length + space.folders.reduce((n, f) => n + f.lists.length, 0);
}

export interface TreeTotals {
  spaces: number;
  folders: number;
  lists: number;
}

export function totalsOf(tree: readonly HierarchySpace[]): TreeTotals {
  return tree.reduce<TreeTotals>(
    (t, s) => ({
      spaces: t.spaces + 1,
      folders: t.folders + s.folders.length,
      lists: t.lists + countListsInSpace(s),
    }),
    { spaces: 0, folders: 0, lists: 0 }
  );
}

// ---------------------------------------------------------------------------------------
// Routes (the single place that spells the URL scheme)
// ---------------------------------------------------------------------------------------

export const hierarchyPaths = {
  space: (spaceId: string) => `/spaces/${spaceId}`,
  folder: (spaceId: string, folderId: string) => `/spaces/${spaceId}/folders/${folderId}`,
  list: (spaceId: string, listId: string) => `/spaces/${spaceId}/lists/${listId}`,
  /** A task opens as a side sheet over its list, so a task URL is the list URL plus the task id. */
  task: (spaceId: string, listId: string, taskId: string) => `/spaces/${spaceId}/lists/${listId}/tasks/${taskId}`,
  /** Stable deep link for places that know only a task id (notifications, search, My Tasks). */
  taskById: (taskId: string) => `/tasks/${taskId}`,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string | undefined): value is string {
  return !!value && UUID_PATTERN.test(value);
}

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/** Breadcrumb trail for the current route params (names come from the loaded tree). */
export function breadcrumbFor(
  tree: readonly HierarchySpace[],
  params: { spaceId?: string; folderId?: string; listId?: string }
): BreadcrumbItem[] {
  const space = findSpace(tree, params.spaceId);
  if (!space) return [];
  const trail: BreadcrumbItem[] = [{ label: space.name, href: hierarchyPaths.space(space.id) }];
  if (params.folderId) {
    const hit = findFolder(tree, params.spaceId, params.folderId);
    if (hit) trail.push({ label: hit.folder.name, href: hierarchyPaths.folder(space.id, hit.folder.id) });
  }
  if (params.listId) {
    const hit = findList(tree, params.spaceId, params.listId);
    if (hit) {
      if (hit.folder) trail.push({ label: hit.folder.name, href: hierarchyPaths.folder(space.id, hit.folder.id) });
      trail.push({ label: hit.list.name, href: hierarchyPaths.list(space.id, hit.list.id) });
    }
  }
  return trail;
}

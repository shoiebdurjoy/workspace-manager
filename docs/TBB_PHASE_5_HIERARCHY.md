# TBB Workspace V2 — Phase 5: Workspace Hierarchy (Spaces → Folders → Lists)
**Document ID:** `docs/TBB_PHASE_5_HIERARCHY.md`
**Roadmap reference:** `docs/TBB_15_PHASE_ROADMAP.md` Phase 05
**Status:** Implemented

---

## 1. What Phase 5 delivers

| Roadmap item | Delivered |
| :--- | :--- |
| Sidebar Space / Folder / List tree | `SpacesTree`: real data, expand/collapse, active highlight, loading / empty / error states, collapsed-sidebar icon mode, mobile drawer |
| Space settings | `SpaceDialog`: name, description, icon, color |
| Client Folders (*CONTENT PIPELINE - ZIM*) / Client Lists (*25. EDAPTX*) | Folder and list dialogs; a list can sit in a folder or directly in a space and can be moved between folders |
| CRUD modals for Spaces, Folders, Lists | Create / edit / delete with validation, saving state, error display and destructive confirmations |
| Nested routes `/spaces/:spaceId/lists/:listId` | `/spaces/:spaceId`, `/spaces/:spaceId/folders/:folderId`, `/spaces/:spaceId/lists/:listId`; ids are validated; unknown, foreign and malformed ids all show the same not-found screen |
| Foreign keys + composite indexes | Already present (migrations 1–4). Verified against the live schema; not duplicated |
| Single efficient query for the navigation tree | `getWorkspaceHierarchy`: three parallel, workspace-filtered, minimal-column queries (no N+1), assembled in memory |
| Empty states for new lists | List page shows an honest "No tasks yet"; no tasks are simulated |
| Hierarchy integration tests | Offline RLS suite, live RLS suite, and data-layer / UI tests |
| **Must NOT implement:** task engine, custom fields | Not implemented |

Also: breadcrumbs from the real tree, ⌘K jumps to real spaces/folders/lists, and the Home page lists the workspace's spaces.

## 2. Reconciling the documents with the database

The tables, workspace-derivation triggers, composite foreign key `(folder_id, space_id)`, indexes, RLS policies and grants already existed and already match `docs/TBB_PERMISSION_MODEL.md`, so they were reused unchanged:

| Action | Roles (enforced by RLS) |
| :--- | :--- |
| See the tree | Owner, Admin, Production Manager, QC Specialist, Editor (Client Viewer fails closed) |
| Create / edit / reorder / delete a **space** | Owner, Admin |
| Create / edit / reorder a **folder or list** | Owner, Admin, Production Manager |
| Delete a **folder or list** | Owner, Admin |

Two deliberate choices:

* **Delete, not archive.** The documents define "Delete Lists or Folders" (Owner/Admin) and no archive state, so deletion is permanent and always behind a confirmation that states what is lost. A space delete removes its folders and lists. A **folder that still contains lists cannot be deleted** (the composite key refuses, so lists are never silently orphaned or destroyed): the UI explains this instead of offering a button that can only fail.
* **Private spaces stay disabled** (migration 1 `CHECK (is_private = false)`) until a membership table for them exists.

## 3. Migration 6 (`20260930000006_hierarchy_ordering_and_constraints.sql`)

Only what Phase 5 still needed:

* `reorder_hierarchy(kind, ids)`: re-sequences siblings in **one atomic statement**. `SECURITY INVOKER`, so the caller's own RLS applies to every row, and it refuses partial results (so a manager cannot reorder spaces and an outsider cannot touch anything). Executable by `authenticated` only.
* `CHECK` constraints on the free-text presentation columns: colors must be `#RRGGBB` (spaces, lists, pods), space icons must be lowercase slugs. A malformed value can never be stored and later rendered into a style attribute.

Existing data already satisfied the constraints. Rollback statements are in the migration header.

## 4. Architecture

```
src/lib/hierarchy.ts          pure logic: validation, ordering, tree assembly, lookups, URL scheme, breadcrumbs
src/database/{spaces,folders,lists}.ts   one small service per level (validation, error mapping)
src/database/hierarchy.ts     tree loading + reorder
src/hooks/use-hierarchy.ts    one query + one mutation hook per action; keys scoped per workspace
src/components/hierarchy/     SpacesTree, dialogs, node menus, page gate, shared provider
src/pages/{SpacePage,FolderPage,ListPage}.tsx
```

* **One dialog provider.** The sidebar, pages, command palette and Home all call `useHierarchyDialogs().open(...)`; navigation after create/delete lives in the provider.
* **One gate for deep links.** `HierarchyGate` validates URL ids, waits for the tree, and maps missing / foreign / no-access to the same screen, so a URL never reveals whether something exists elsewhere.
* **Position handling.** New items append (`nextPosition`); moves go through `reorderHierarchy`; moving a list to another folder appends it there.
* **Browser storage.** Only the sidebar's open/closed nodes (`tbb_sidebar_expanded`), a UI preference. No data and no auth state.
* **Phase 6 hook-in.** `ListPage` has a marked placeholder where the task engine renders; tasks reference `lists.id` already.

## 5. Security

* RLS is the boundary; the UI only hides what a role cannot do. Cross-workspace parent injection is refused by the workspace-derivation triggers, the composite folder/space key, and RLS.
* `reorder_hierarchy` is invoker-rights: it adds no privilege.
* Zero-row results from `UPDATE`/`DELETE` are treated as permission failures (RLS hides rows rather than raising).
* Supabase advisors: no database, RLS or function finding. The only advisor item is the Auth setting "leaked password protection", a plan-level toggle unrelated to this phase.

## 6. Verification performed

* Unit / component / integration tests, offline RLS suite (234 checks), live RLS suite against the real project (214 checks, 57 for Phase 5) with temporary users that are always removed.
* The exact data-layer functions the UI calls were run against the live project as admin, production manager, editor and an outsider in another workspace, including a fresh sign-in showing the same hierarchy.
* In a real browser (UI with the database layer replaced by an in-memory stand-in): create a space, a folder and a list; nested sidebar, active highlight, breadcrumbs, keyboard submit, mobile drawer, tablet and desktop widths, no console errors.

## 7. Known limits

* Reordering is move up / move down (atomic and permission-checked); drag-and-drop ordering is a later UX refinement.
* Spaces are not private yet; every staff member sees every space.
* Lists have no task data until Phase 6 (delivered: see `docs/TBB_PHASE_6_TASK_ENGINE.md`).
* Deleting a space that will later contain tasks removes them too; the confirmation already says "and everything in them".

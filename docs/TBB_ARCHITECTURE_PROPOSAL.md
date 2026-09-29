# TBB Workspace V2 — System Architecture Proposal
**Document ID:** `docs/TBB_ARCHITECTURE_PROPOSAL.md`  
**Date:** September 30, 2026  
**Status:** Architectural Blueprint for Engineering Review  
**Target Scale:** 100 Concurrent Internal Users, ~20,000 Annual Video Tasks  
**Design Philosophy:** Pragmatic, High-Performance, Scalable, Maintainable  

---

## 1. Architecture Overview & Topology

TBB Workspace is designed as a **modern Single Page Application (SPA)** backed by **Supabase Platform Services (Managed PostgreSQL 15+, GoTrue Auth, PostgREST API, Realtime WebSockets, and Storage)**.

```
+─────────────────────────────────────────────────────────────────────────────+
|                             CLIENT TIER (BROWSER)                           |
|                                                                             |
|  +───────────────────────────────────────────────────────────────────────+  |
|  | Vite + React 18.3 + TypeScript (Strict)                               |  |
|  |                                                                       |  |
|  |  +──────────────────+   +──────────────────+   +───────────────────+  |  |
|  |  | Routing:         |   | Server State:    |   | UI & Client State:|  |  |
|  |  | React Router v6  |   | TanStack Query v5|   | Zustand Store     |  |  |
|  |  | Nested Paths     |   | Cache & Mutation |   | Transient State   |  |  |
|  |  +──────────────────+   +──────────────────+   +───────────────────+  |  |
|  |                                                                       |  |
|  |  +─────────────────────────────────────────────────────────────────+  |  |
|  |  | UI Component System: Radix UI Primitives + Tailwind CSS + CVA    |  |  |
|  |  | High-Density Virtual Lists: @tanstack/react-virtual              |  |  |
|  |  | Drag & Drop Engine: @dnd-kit/core + @dnd-kit/sortable           |  |  |
|  |  +─────────────────────────────────────────────────────────────────+  |  |
|  +───────────────────────────────────────────────────────────────────────+  |
+──────────────────────────────────────┬──────────────────────────────────────+
                                       │ HTTPS / WSS
                                       ▼
+─────────────────────────────────────────────────────────────────────────────+
|                         BACKEND TIER (SUPABASE PLATFORM)                    |
|                                                                             |
|  +───────────────────+   +───────────────────+   +───────────────────────+  |
|  | Supabase Auth     |   | PostgREST API     |   | Realtime Engine       |  |
|  | (GoTrue / JWT)    |   | Auto-generated    |   | WebSockets Broadcast  |  |
|  | Token Rotation    |   | CRUD & RPC        |   | Postgres WAL Stream   |  |
|  +───────────────────+   +───────────────────+   +───────────────────────+  |
|            │                       │                         │              |
|            ▼                       ▼                         ▼              |
|  +───────────────────────────────────────────────────────────────────────+  |
|  | PostgreSQL 15+ Core Database Engine                                   |  |
|  |                                                                       |  |
|  |  - Row Level Security (RLS) Policies on every table                   |  |
|  |  - Relational Schema (Workspaces, Spaces, Folders, Lists, Tasks)      |  |
|  |  - Composite B-Tree & GIN Indexes (Search, Status, Due Dates)         |  |
|  |  - Transactional Triggers (Auto-audit logs, revision counters)        |  |
|  |  - Custom RPC Functions (Batch reordering, multi-status updates)     |  |
|  +───────────────────────────────────────────────────────────────────────+  |
|                                    │                                        |
|                                    ▼                                        |
|  +───────────────────────────────────────────────────────────────────────+  |
|  | Supabase Storage (S3-Compatible)                                      |  |
|  | Buckets: `task-attachments`, `user-avatars`, `reference-thumbnails`   |  |
|  +───────────────────────────────────────────────────────────────────────+  |
+─────────────────────────────────────────────────────────────────────────────+
```

---

## 2. Client Tier Architecture

### 2.1 State Management Division
To prevent excessive re-renders and data stale-locks, client state is partitioned into 3 clear domains:

1. **Server State (TanStack Query v5):**
   * **Source of Truth:** Remote PostgreSQL database.
   * **Responsibilities:** Fetching, caching, invalidating, and optimistically updating tasks, spaces, lists, and users.
   * **Cache Strategy:** Stale-while-revalidate (`staleTime: 60_000` for spaces/metadata; `staleTime: 10_000` for active tasks).
   * **Optimistic Mutations:** Status changes, priority changes, and title edits reflect instantly in the UI before network confirmation. If the request fails, the cache automatically rolls back to the previous snapshot and displays a notification.

2. **UI & Navigation State (Zustand):**
   * **Responsibilities:** Active sidebar expansion, modal open/closed states, active view preference (`list`, `board`, `table`, `calendar`), selected task drawer ID, bulk selection set.
   * **Persistence:** Saved to `localStorage` under isolated keys (`tbb_sidebar_collapsed`, `tbb_view_preferences`).

3. **URL & Navigation State (React Router v6):**
   * **Deep Linking:** The URL is the single source of truth for navigation:
     * `/spaces/:spaceId`
     * `/spaces/:spaceId/folders/:folderId`
     * `/spaces/:spaceId/lists/:listId`
     * `/tasks/:taskId` (opens task detail drawer over current view)
   * Ensures team members can share exact links to specific lists or video tasks in Slack.

---

## 3. Data Tier & Query Performance Architecture

### 3.1 Addressing High Volume & List Performance
A video agency with ~100 staff will generate thousands of tasks per quarter. Loading all tasks at once into React memory degrades performance.

**Architectural Solutions:**
1. **Database-Level Pagination & Scoping:**
   * Global task queries are strictly scoped to the active list or folder:
     ```sql
     SELECT * FROM tasks WHERE list_id = $1 ORDER BY sort_order ASC, due_date ASC LIMIT 100;
     ```
   * The "Everything" space uses cursor-based pagination or date-range filtering (e.g., active tasks in last 30 days).
2. **Virtual Windowing:**
   * The List and Table views use `@tanstack/react-virtual` to only render DOM elements currently visible in the user's viewport (e.g., 30 DOM nodes rendered even if a list has 1,500 tasks).
3. **Database Indexing Strategy:**
   * B-tree indexes on `(list_id, status_id, sort_order)`.
   * Composite index on `(assigned_editor_id, status_id)` for lightning-fast "My Tasks" loading.
   * PostgreSQL `pg_trgm` GIN index on `tasks.title` for instant sub-string searching.

---

## 4. Authentication & Security Architecture

### 4.1 Pure Supabase Auth (Elimination of Offline Fallback)
* **Zero Client-Side Session Spoofing:** Completely remove all artificial `localStorage` fallback logic. If authentication fails, the application displays a clean, user-friendly error screen with real retry mechanisms.
* **Token Rotation & Session Persistence:** Handled natively by `@supabase/supabase-js` using standard PKCE flow with secure browser storage.
* **Route Protection:** A single `ProtectedRoute` component validates session existence and claims before rendering private application layouts.

### 4.2 Two-Tier Authorization Model
1. **Tier 1 — Backend Database Layer (Row Level Security):**
   * Every SQL query runs under PostgreSQL Row Level Security (RLS).
   * Even if a malicious user manipulates frontend code, the database rejects unauthorized reads, writes, or status updates.
2. **Tier 2 — Client Interface Layer (Capability Gates):**
   * UI components use declarative capability checks (e.g., `<Can perform="task:approve-qc">...<Button>Approve</Button></Can>`) to hide or disable buttons the current user cannot execute.

---

## 5. Real-Time Communication & Activity Architecture

### 5.1 Realtime Status Sync
* When an Editor finishes a video and submits it to QC, the QC specialist's board updates automatically without page reload.
* Utilizes Supabase Realtime Channels subscribed to PostgreSQL CDC (Change Data Capture) filtered by space:
  ```typescript
  supabase
    .channel(`space-${spaceId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `space_id=eq.${spaceId}` }, payload => {
      queryClient.invalidateQueries({ queryKey: ['tasks', payload.new.list_id] });
    })
    .subscribe();
  ```

### 5.2 Transactional Activity Logging
* Activity logging must never depend on the frontend remembering to send a log request.
* A PostgreSQL trigger on `tasks` automatically writes an immutable row into `activity_logs` whenever `status_id`, `assigned_editor_id`, `priority_id`, or `review_link` changes:
  ```sql
  CREATE TRIGGER on_task_field_change
  AFTER UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_task_activity();
  ```

---

## 6. External Integrations Architecture (Video Production)

TBB utilizes Google Drive and Frame.io for heavy media storage. Storing multi-gigabyte 4K ProRes video files directly in the web application database is an anti-pattern.

### Storage Boundary Design:
1. **Metadata & Small Assets (TBB Workspace / Supabase):**
   * Task metadata, brief descriptions, revision notes, image thumbnails, script documents, and exported audio stems (<50MB) are stored in Supabase Storage buckets.
2. **Heavy Video Assets (Google Drive / Frame.io):**
   * Raw footage (50GB–500GB) and master video exports live in Google Drive.
   * Interactive video reviews live in Frame.io.
   * TBB Workspace stores validated, structured external links with deep-link launch icons.

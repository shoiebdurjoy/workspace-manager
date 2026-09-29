# TBB Workspace V2 — 15-Phase Production Engineering Roadmap
**Document ID:** `docs/TBB_15_PHASE_ROADMAP.md`  
**Date:** September 30, 2026  
**Execution Standard:** Strictly Sequential, Gate-Controlled, Zero Feature Creep  
**Target Environment:** Think Big Brand (~100 Active Team Members)  

---

## Roadmap Overview

```
Phase 01 ──► Phase 02 ──► Phase 03 ──► Phase 04 ──► Phase 05
Audit &       Shell &       Database      Auth &        Hierarchy
Blueprint    Design        Foundation    Teams         (Space/Folder/List)
   │
   ▼
Phase 06 ──► Phase 07 ──► Phase 08 ──► Phase 09 ──► Phase 10
Task Engine  TBB Workflow  Multi-View    Search &      Comments, Media
& Metadata   & QC Engine   (List/Board)  Filters       & Activity
   │
   ▼
Phase 11 ──► Phase 12 ──► Phase 13 ──► Phase 14 ──► Phase 15
Home &       Custom Fields Calendar,     Admin, Docs   Hardening, Scale
Inbox Hub    & Templates   Timeline      & Dashboards  & Deployment
```

---

### PHASE 01: Audit + Requirements + Architecture
* **Objective:** Conduct a complete technical audit of the existing codebase, identify root causes of backend connectivity failures, analyze TBB production requirements, and produce comprehensive architectural blueprints.
* **Features:** Read-only audit documentation, gap analysis, target architecture specification, normalized schema proposal, testing strategy.
* **Dependencies:** None.
* **Database Requirements:** None (no migrations executed).
* **Frontend Requirements:** Read-only code inspection; identify fake/mock bypasses and ESLint errors.
* **Backend Requirements:** Execute diagnostic tests against Supabase DNS, endpoints, and credentials.
* **Tests:** `npm run lint` audit, `npm run build` verification, DNS socket probes.
* **Acceptance Criteria:** All 7 documentation files created in `docs/`; exact cause of DNS failure proven with evidence; feature gap matrix complete.
* **What Must NOT Be Implemented Yet:** No application source code refactoring; no schema migration execution; no new UI features.

---

### PHASE 02: Application Shell + Design System
* **Objective:** Establish the high-density ClickUp 3.0 visual design system, typography tokens, layout shell, and install the Vitest automated testing harness.
* **Features:** Modernized App Shell (`Layout`, `Sidebar`, `Navbar`), command palette trigger (`Cmd+K`), theme tokens (ClickUp purple, status colors, priority flags), responsive collapsible navigation, Vitest test runner configuration.
* **Dependencies:** Phase 01 approval.
* **Database Requirements:** None.
* **Frontend Requirements:** Set up Vitest + React Testing Library; resolve all 33 ESLint errors (including Rules of Hooks in `WorkspaceNew.tsx`); remove dead CSS.
* **Backend Requirements:** None.
* **Tests:** Unit test runner operational (`npm test`); component tests for `Button`, `Badge`, `SidebarNav`.
* **Acceptance Criteria:** `npm test` runs and passes; `npm run lint` reports 0 errors and 0 warnings; layout renders smoothly without layout shifts.
* **What Must NOT Be Implemented Yet:** No backend data queries; no authentication refactoring; no live task fetching.

---

### PHASE 03: Backend + Database Foundation
* **Objective:** Provision a working, reachable Supabase PostgreSQL instance, configure valid `.env` credentials, and deploy the core relational schema with foundational RLS policies.
* **Features:** Live PostgreSQL 15+ database connection; repeatable numbered SQL migrations (`00001_initial_schema.sql`); strongly-typed Supabase TypeScript client (`src/types/database.types.ts`).
* **Dependencies:** Phase 02 completion, active Supabase project with valid DNS resolution.
* **Database Requirements:** Tables: `profiles`, `workspaces`, `workspace_members`, `spaces`, `folders`, `lists`, `workflows`, `statuses`, `priorities`, `tasks`. Initial RLS policies enabled.
* **Frontend Requirements:** Replace `src/lib/supabase.ts` with typed client; verify environment variables load without fallback placeholders.
* **Backend Requirements:** Supabase database provisioned in optimal region; migrations run cleanly in SQL Editor.
* **Tests:** Database connectivity test script passes with HTTP 200/204; initial migration executes with zero SQL errors.
* **Acceptance Criteria:** Real network queries succeed against live database; zero DNS `ENOTFOUND` errors.
* **What Must NOT Be Implemented Yet:** No client-side offline mock fallbacks; no UI state wiring.

---

### PHASE 04: Authentication + Users + Teams
* **Objective:** Implement production-grade Supabase authentication, eliminating all fake offline fallbacks, and establish team/pod user management.
* **Features:** Real signup, login, session persistence, password reset, profile auto-creation trigger on `auth.users`, role assignment (Owner, Admin, Manager, QC, Editor), and creative pods (`teams`, `team_members`).
* **Dependencies:** Phase 03.
* **Database Requirements:** `handle_new_user()` trigger; `profiles` and `team_members` RLS policies.
* **Frontend Requirements:** Strip all localStorage auth simulation from `AuthContext.tsx`; rebuild login/register with real Supabase Auth calls; add loading/error state handling.
* **Backend Requirements:** Supabase GoTrue Auth configured with email confirmation policies.
* **Tests:** Auth integration tests: successful login, invalid credentials error handling, session restore on refresh, role verification.
* **Acceptance Criteria:** Users can register and log in against live Supabase Auth; zero fake sessions in `localStorage`.
* **What Must NOT Be Implemented Yet:** Task creation or workspace navigation.

---

### PHASE 05: Workspace Hierarchy (Spaces + Folders + Lists)
* **Objective:** Build the structural container foundation of the ClickUp-style 6-level hierarchy: Workspace → Space → Folder → List → Task → Subtask (implementing Spaces, Folders, and Lists containers) supporting real TBB client pipelines.
* **Features:** Sidebar Space/Folder/List tree; Space settings; Client Folders (e.g. *CONTENT PIPELINE - ZIM*); Client Lists (e.g. *25. EDAPTX*, *50. THE DESIRE COMPANY*); CRUD modals for Spaces, Folders, and Lists.
* **Dependencies:** Phase 04.
* **Database Requirements:** Foreign keys between `spaces`, `folders`, `lists`; composite indexes on `(space_id, sort_order)`.
* **Frontend Requirements:** Nested route structure in `App.tsx` (`/spaces/:spaceId/lists/:listId`); recursive sidebar tree navigation; empty states for newly created lists.
* **Backend Requirements:** PostgREST queries fetching full navigation tree in a single efficient query.
* **Tests:** Hierarchy integration tests: creating a space, creating nested client folders, creating deliverable lists.
* **Acceptance Criteria:** Users can navigate between multiple TBB client pipelines seamlessly; active route reflects exact space and list IDs.
* **What Must NOT Be Implemented Yet:** Task engine or custom fields.

---

### PHASE 06: Task Engine & Video Deliverable Metadata
* **Objective:** Implement the core video task entity with full support for video production fields, subtasks, and multiple assignees.
* **Features:** Task creation, task detail drawer (`TaskDetailSheet`), primary Editor assignment, QC Specialist assignment, Aspect Ratio selection (`9:16`, `16:9`), Drive raw footage link, Frame.io review link, final export link, internal QC due date, client deadline, subtask checklist.
* **Dependencies:** Phase 05.
* **Database Requirements:** Tables `tasks`, `task_assignees`, `subtasks`; triggers for updated timestamps.
* **Frontend Requirements:** Comprehensive task creation modal; high-density task detail view; input validation for video URLs.
* **Backend Requirements:** Transactional task insertion supporting simultaneous assignee linking.
* **Tests:** Task CRUD unit tests, URL validator tests, subtask progress calculation tests.
* **Acceptance Criteria:** Users can create a video deliverable task with all TBB production fields and assign an editor and QC specialist.
* **What Must NOT Be Implemented Yet:** Dynamic workflow customizer or multi-view engine.

---

### PHASE 07: TBB Workflow & Status Engine
* **Objective:** Deploy TBB's 10-stage production pipeline with automated QC gating, revision counters, and role-based status transition rules.
* **Features:** Configurable workflow engine; TBB statuses (*TO BE EDITED, ASSIGNED, STARTED EDITING, IN EDIT, QC - FIRST APPROVAL, QC - REVISION NEEDED, QC - FINAL APPROVAL, QC - APPROVED (RTD), SENT TO CLIENT, CLOSED*); revision counter auto-increment; QC rejection notes prompt.
* **Dependencies:** Phase 06.
* **Database Requirements:** PostgreSQL trigger: moving to `QC - REVISION NEEDED` increments `revision_count`; RLS policy: only QC Specialists/Admins can set status to `QC - APPROVED (RTD)`.
* **Frontend Requirements:** Interactive status pill dropdown; revision feedback modal; role-gated status options (disabled for non-QC staff).
* **Backend Requirements:** RLS security enforcement on restricted statuses.
* **Tests:** Status transition unit tests; RLS rejection tests when editors attempt to self-approve videos.
* **Acceptance Criteria:** Editors cannot approve their own videos; moving to revision increments revision count; full workflow operational.
* **What Must NOT Be Implemented Yet:** Views other than primary List view.

---

### PHASE 08: Multi-View System (List + Board + Table)
* **Objective:** Deliver ClickUp-standard view switching across every list, folder, and space.
* **Features:**
  * **List View:** Grouped by status with collapsible colored headers, task counts, and inline row creation.
  * **Board View:** Kanban columns with `@dnd-kit` drag-and-drop and optimistic UI updates.
  * **Table View:** High-density spreadsheet grid with inline cell editing for status, dates, and links.
* **Dependencies:** Phase 07.
* **Database Requirements:** Batch sort order update RPC function (`reorder_tasks`).
* **Frontend Requirements:** Modularized view components (`TaskListView`, `TaskBoardView`, `TaskTableView`); virtual scrolling via `@tanstack/react-virtual`.
* **Backend Requirements:** Optimized PostgREST queries with select projections.
* **Tests:** View switching tests; Kanban drag-and-drop integration tests; virtual list scroll benchmark (<100ms render for 1,000 tasks).
* **Acceptance Criteria:** User can switch between List, Board, and Table views instantly with persistent user preferences.
* **What Must NOT Be Implemented Yet:** Calendar, Gantt, or Timeline views.

---

### PHASE 09: Advanced Search, Filters & Sorting
* **Objective:** Implement fast search and multi-parameter filtering across all client pipelines and video tasks.
* **Features:** Global Command Palette (`Ctrl + K` / `Cmd + K`); fast fuzzy search; filters by Assignee, QC Reviewer, Priority, Aspect Ratio, Payment Status, and Due Date Range; multi-column sorting.
* **Dependencies:** Phase 08.
* **Database Requirements:** PostgreSQL GIN indexes using `pg_trgm` on `tasks.title` and `tasks.description`.
* **Frontend Requirements:** Command palette modal (`cmdk`); filter pill bar with active count badge; filter clear actions.
* **Backend Requirements:** Dynamic PostgREST filter string generation.
* **Tests:** Search query latency tests (<50ms); multi-filter combination tests.
* **Acceptance Criteria:** Pressing `Cmd+K` allows typing any client name or video title and navigating directly to it in <100ms.
* **What Must NOT Be Implemented Yet:** Automations or custom fields.

---

### PHASE 10: Comments, Attachments, Activity & Notifications
* **Objective:** Integrate real-time collaboration, video timestamped notes, and an in-app notification center.
* **Features:** Threaded comments with `@mentions`; timestamped video comments (e.g. `00:45 - Fix audio pop`); file attachments (scripts, audio stems); automated task activity history log; notification center (bell icon).
* **Dependencies:** Phase 09.
* **Database Requirements:** Tables `comments`, `attachments`, `activity_logs`, `notifications`; triggers for auto-logging field updates.
* **Frontend Requirements:** Task detail activity tab; comment input with rich text; notification dropdown with unread badge.
* **Backend Requirements:** Supabase Storage bucket `task-attachments` with authenticated upload policies.
* **Tests:** Notification delivery tests; comment threading tests; file upload size limit enforcement tests.
* **Acceptance Criteria:** Commenting with `@mention` triggers notification to mentioned user; all status changes automatically logged in audit history.
* **What Must NOT Be Implemented Yet:** Client portal public views.

---

### PHASE 11: Home, Inbox & My Tasks
* **Objective:** Provide personalized productivity hubs for individual editors, QC specialists, and managers.
* **Features:**
  * **My Tasks:** Filtered view showing all tasks assigned to the current user, categorized by urgency and due date.
  * **Inbox:** Centralized feed of notifications, review requests, and revision alerts with "Mark Done" actions.
  * **Home Dashboard:** High-level overview: active tasks, pending QC queue, recent activity, and sprint progress.
* **Dependencies:** Phase 10.
* **Database Requirements:** Composite indexes for user-specific assignment queries.
* **Frontend Requirements:** Personalized dashboard components; quick-action buttons directly on task rows.
* **Backend Requirements:** Aggregation RPC for personal task metrics.
* **Tests:** My Tasks filter verification; Inbox notification read/dismiss integration tests.
* **Acceptance Criteria:** Editors log in directly to My Tasks and see their exact assignments and revision feedback without searching.
* **What Must NOT Be Implemented Yet:** Custom dashboard builders.

---

### PHASE 12: Custom Fields, Templates & Automations
* **Objective:** Allow managers to add custom columns to lists and automate routine status assignments.
* **Features:** Custom fields engine (Dropdown, Number, URL, Text); List & Task templates (e.g., standard "YouTube Package Template" with pre-set subtasks); basic automations (e.g., when status changes to `QC - FIRST APPROVAL`, assign Lead QC).
* **Dependencies:** Phase 11.
* **Database Requirements:** Tables `custom_fields`, `custom_field_values`, `templates`.
* **Frontend Requirements:** Custom field manager dialog; template selector on list creation.
* **Backend Requirements:** Automated trigger execution on task updates.
* **Tests:** Custom field serialization tests; template instantiation tests.
* **Acceptance Criteria:** Managers can create a new client list from a template with 1 click, complete with standard statuses and subtasks.
* **What Must NOT Be Implemented Yet:** Complex multi-step visual automation builders.

---

### PHASE 13: Calendar, Timeline & Workload Views
* **Objective:** Provide visual timeline and resource allocation views for production leadership.
* **Features:** Interactive monthly/weekly Calendar view; Timeline/Gantt view showing client delivery sequences; Editor Workload view displaying number of assigned videos per editor.
* **Dependencies:** Phase 12.
* **Database Requirements:** Date range queries with index optimization.
* **Frontend Requirements:** Calendar grid component; editor capacity bar indicators.
* **Backend Requirements:** PostgREST date filter queries.
* **Tests:** Calendar date boundary tests; editor task count calculation tests.
* **Acceptance Criteria:** Managers can spot editor over-allocation and rebalance tasks by dragging dates on the calendar.
* **What Must NOT Be Implemented Yet:** Advanced AI scheduling.

---

### PHASE 14: Forms, Dashboards & Team Administration
* **Objective:** Add internal creative brief intake forms, agency analytics, and formal user management.
* **Features:** Client intake form builder (public or internal submission generating a task in *CONTENT PIPELINE*); Agency KPI Dashboard (videos completed per week, average turnaround time, revisions per client); Admin user management screen (deactivate users, change roles).
* **Dependencies:** Phase 13.
* **Database Requirements:** Tables `forms`, `form_submissions`; aggregation functions for KPI metrics.
* **Frontend Requirements:** Public-facing form submit page; Recharts agency analytics dashboard; Admin user table.
* **Backend Requirements:** Secure form ingestion API endpoint.
* **Tests:** Form submission validation tests; admin role-change authorization tests.
* **Acceptance Criteria:** Submitting a creative brief form instantly creates a task in the target client list with footage links attached.
* **What Must NOT Be Implemented Yet:** External client invoicing integrations.

---

### PHASE 15: Security Hardening, Performance Optimization & Production Rollout
* **Objective:** Perform end-to-end security audits, database query profiling, bundle minification, and deploy to production for the 100-user TBB team.
* **Features:** Production build optimization (code-splitting, dynamic imports); HTTP security headers; rate limiting; backup automation; user acceptance testing (UAT); staff onboarding documentation.
* **Dependencies:** All previous phases.
* **Database Requirements:** Database backup schedules; `pg_stat_statements` query plan analysis.
* **Frontend Requirements:** Bundle chunks under 300kB; zero console warnings; Lighthouse performance score > 90.
* **Backend Requirements:** Production Supabase instance upgraded to appropriate compute tier; SSL certificates verified.
* **Tests:** Full Playwright E2E regression suite (15+ critical paths); load testing with 100 concurrent virtual users; penetration scan for RLS leaks.
* **Acceptance Criteria:** 100 TBB team members successfully onboarded; sub-100ms task interactions; zero offline fallbacks; zero security vulnerabilities.

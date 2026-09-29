# TBB Workspace V2 — Quality Assurance & Testing Strategy
**Document ID:** `docs/TBB_TESTING_STRATEGY.md`  
**Date:** September 30, 2026  
**Standard:** Enterprise Agency Production Reliability  
**Policy:** Zero Untested Features — Every Phase Must Pass Designated Quality Gates  

---

## 1. Testing Pyramid & Tooling Landscape

The current codebase has **0 automated tests**. Moving from a fragile prototype to an internal operations system used daily by ~100 staff requires a strict, automated test hierarchy.

```
                     / \
                    /   \     E2E Tests (Playwright)
                   / E2E \    ~15 Critical Paths (Login, QC Handoff, Kanban DnD)
                  /───────\
                 /  INTEG  \  Integration & API Tests (MSW + Vitest + React Testing Library)
                /───────────\ ~60 Tests (Queries, Mutations, Status Transitions)
               /    UNIT     \Unit Tests (Vitest)
              /───────────────\~150 Tests (Formatting, Mappers, Permissions, Validation)
             /    DATABASE     \pgTAP / SQL Tests
            /───────────────────\RLS Policies, Triggers, Foreign Keys
```

### Approved Testing Stack:
* **Test Runner:** **Vitest** (Fast, native ESM/SWC integration with Vite).
* **Component Testing:** **React Testing Library** + `@testing-library/jest-dom`.
* **API Mocking:** **Mock Service Worker (MSW v2)** (Mocking PostgREST responses in memory without hitting live DB during unit/integration tests).
* **End-to-End (E2E):** **Playwright** (Testing full browser interactions across Chromium and Firefox).
* **Database & RLS Testing:** **pgTAP** or Supabase Local Testing Container.

---

## 2. Test Specifications by Layer

### 2.1 Unit Tests (Vitest)
* **Scope:** Pure functions, date/time calculations, status mappers, permissions evaluators, URL link validators.
* **Key Targets:**
  * Status color and category mapping functions.
  * Aspect ratio formatting (`9:16`, `16:9`).
  * Deadline calculations (highlighting overdue tasks, calculating hours remaining).
  * Video link parsing (ensuring Google Drive, Frame.io, and Vimeo URLs format properly).
  * Editor rate aggregations and pending payment sums.

### 2.2 Component & UI Tests (React Testing Library)
* **Scope:** Visual states, accessibility, keyboard navigation, form validation.
* **Key Targets:**
  * `QuickTaskModal`: Submitting with empty title triggers error; selecting status populates priority flags.
  * `KanbanColumn`: Renders correct task count badge; applies color border corresponding to status.
  * `ListView`: Collapsing a status group hides task rows; clicking "+ Add Task" opens pre-filled form.
  * `TaskDetail`: Payment amount hidden if current user is another editor; visible if manager.

### 2.3 Integration & API Tests
* **Scope:** TanStack Query hooks interacting with Supabase client wrappers via MSW.
* **Key Targets:**
  * `useTasks(listId)`: Returns cached data immediately; re-fetches in background on window focus.
  * `useUpdateTaskStatus`: Optimistically updates the task card on the board; successfully handles network failure by rolling back card position and displaying error toast.
  * `useCreateWorkspace`: Rejects creation if user is an Editor; succeeds if user is Admin.

### 2.4 Authentication & Session Tests
* **Scope:** GoTrue client lifecycle, token refreshes, session eviction.
* **Key Targets:**
  * Expired JWT token triggers transparent refresh via refresh token.
  * 401 Unauthorized from backend redirects user to `/login` without white-screen crash.
  * Logout clears all session keys from browser storage and resets TanStack Query cache.
  * **Zero offline fallback:** Verifies that a network failure on login displays `"Unable to connect to authentication server"` rather than faking a login.

### 2.5 Database & Row Level Security (RLS) Tests
* **Scope:** SQL constraints, triggers, and PostgreSQL security policies.
* **Key Targets:**
  * As an `EDITOR`, executing `UPDATE tasks SET status_id = 'approved-rtd-id'` fails with RLS policy violation.
  * As a `QC_SPECIALIST`, executing the same `UPDATE` succeeds.
  * Inserting a task with an invalid `list_id` fails foreign key constraint.
  * Moving a task to `QC - REVISION NEEDED` automatically fires trigger incrementing `revision_count` by 1.

### 2.6 End-to-End (E2E) Tests (Playwright)
* **Scope:** Full user journeys simulating real agency operations.
* **Standard Test Scenarios:**
  1. **Journey 1: Editor Submits Video for Review:**
     * Editor logs in -> Navigates to assigned list (*25. EDAPTX*) -> Opens task -> Enters Frame.io review link -> Changes status from `IN EDIT` to `QC - FIRST APPROVAL` -> Task moves to QC column.
  2. **Journey 2: QC Specialist Reviews and Rejects:**
     * QC Specialist logs in -> Sees task in QC queue -> Adds timestamped comment -> Moves status to `QC - REVISION NEEDED` -> Editor receives notification.
  3. **Journey 3: QC Specialist Approves Deliverable:**
     * QC Specialist verifies master export link -> Clicks `Approve (RTD)` -> Status updates -> Task marked Ready To Deliver.

### 2.7 Performance & Load Benchmarks
* **Benchmark 1 (List Rendering):** Render 1,000 tasks in ClickUp List View; DOM node count must remain < 150 nodes via virtual windowing; initial render < 100ms.
* **Benchmark 2 (Memory Leak Check):** Navigating between 10 different lists in rapid succession must not increase detached DOM nodes or cause memory leaks in TanStack Query cache.

---

## 3. Phase Quality Gates (Definition of Done)

No development phase in the 15-phase roadmap can be marked complete unless it satisfies the following quality gates:

| Quality Gate | Requirement | Tool / Verification |
| :--- | :--- | :--- |
| **Lint & Style** | 0 ESLint errors, 0 ESLint warnings | `npm run lint` |
| **Type Safety** | 0 TypeScript errors under `strict: true`, no `any` | `tsc --noEmit` |
| **Unit Test Coverage** | Minimum 85% coverage on new utility/service code | `vitest run --coverage` |
| **Component Tests** | All interactive states (loading, empty, error, filled) tested | React Testing Library |
| **RLS Policy Validation** | All new tables must have verified RLS tests | Supabase Test Runner / pgTAP |
| **Production Build** | Clean build with asset chunks < 500kB | `npm run build` |
| **No Mock Data Leak** | Zero hardcoded dummy arrays or fake offline fallbacks in production files | Automated search audit |

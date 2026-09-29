# TBB Workspace V2 — Role-Based Access Control & Permission Model
**Document ID:** `docs/TBB_PERMISSION_MODEL.md`  
**Date:** September 30, 2026  
**Security Classification:** Confidential — Internal TBB Operational Architecture  
**Target:** Role-Based Access Control (RBAC) & PostgreSQL Row Level Security (RLS)  

---

## 1. Role Definitions & Hierarchy

TBB operates with distinct specialized functions. A binary `AUTHOR` / `EMPLOYEE` model is inadequate for a 100-person video production agency. We define 6 operational roles:

```
[ OWNER ] ──► [ ADMIN ] ──► [ PRODUCTION MANAGER ] ──► [ QC SPECIALIST ] ──► [ EDITOR ] ──► [ CLIENT VIEWER ]
  Executive     Operations     Team / Pod Leads           Quality Gate         Execution      External Review
```

### 1.1 Role Profiles:
1. **OWNER (Executive):**
   * Founders & Executive Leadership.
   * Full root authority across all workspaces, financial data, rate cards, and billing.
2. **ADMIN (Head of Production / Operations):**
   * Operations managers.
   * Creates/deletes spaces and folders, invites/removes users, configures global workflows, overrides QC decisions.
3. **PRODUCTION MANAGER (Pod Lead / Producer):**
   * Leads client pipelines (e.g. Lead Producer for *CONTENT PIPELINE - ZIM*).
   * Creates client lists, allocates tasks to editors, assigns QC specialists, approves editor payouts.
4. **QC SPECIALIST (Quality Control Reviewer):**
   * Dedicated video review personnel.
   * Authority to approve tasks to `QC - APPROVED (RTD)` and `SENT TO CLIENT`, or reject tasks to `QC - REVISION NEEDED` with detailed notes.
5. **EDITOR (Video Editor / Motion Designer):**
   * Production team members.
   * Views assigned tasks, changes status between `ASSIGNED`, `STARTED EDITING`, and `IN EDIT`, submits preview links for QC review. Cannot approve their own videos to QC Passed.
6. **CLIENT VIEWER (External Reviewer / Guest):**
   * Restricted client contact.
   * Read-only access scoped strictly to their client list or review links. Can leave comments and sign off on client approvals.

---

## 2. Granular Permissions Matrix

| Capability / Action | Owner | Admin | Production Manager | QC Specialist | Editor | Client Viewer |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Workspace Settings & Billing** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Invite / Deactivate Users** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Change User Roles** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Create Spaces & Global Workflows**| ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Create Client Folders & Lists** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Delete Lists or Folders** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Create Video Tasks** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Assign Editors & QC Reviewers** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Edit Task Brief & Due Dates** | ✅ | ✅ | ✅ | ⚠️ (Notes only) | ❌ | ❌ |
| **Update Editing Status (`IN EDIT`)**| ✅ | ✅ | ✅ | ✅ | ✅ (Own tasks) | ❌ |
| **Approve Task to QC Passed (`RTD`)**| ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Deliver to Client (`SENT TO CLIENT`)**| ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Close Task (`CLOSED`)** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **View Editor Pay Rates / Financials**| ✅ | ✅ | ✅ | ❌ | ✅ (Own rate) | ❌ |
| **Approve Editor Payments** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **View Internal Comments** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (Client mode) |
| **Post Comments & Revisions** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 3. Structural Scoping (Inherited Permissions)

Permissions cascade downwards through the hierarchy:

1. **Workspace Level:**
   * Global role stored in `public.profiles.role`.
   * Establishes baseline permissions across all spaces.
2. **Space Level:**
   * Spaces can be marked `is_private = true`.
   * Only members explicitly added to `space_members` can see the space and its nested folders and lists.
3. **Folder & List Level:**
   * Inherits from parent Space.
   * Client lists can have specific `CLIENT_VIEWER` guest permissions attached.
4. **Task Level:**
   * Editors have write access to operational fields (`status`, `review_link`, `project_file_link`) **only on tasks assigned to them**.

---

## 4. PostgreSQL Row Level Security (RLS) Blueprint

To guarantee that permissions cannot be bypassed via browser console or direct API requests, all security rules are enforced at the PostgreSQL engine level.

### Example 1: View Tasks Policy
Users can view tasks if they are an Admin/Manager, or if the task is in a public space, or if they are assigned to the task.

```sql
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tasks viewable by authorized workspace members"
ON public.tasks
FOR SELECT
USING (
  -- Admins, Owners, and Production Managers can view all tasks
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER')
  )
  OR
  -- Editors can view tasks assigned to them or tasks in their team's space
  (assigned_editor_id = auth.uid() OR assigned_qc_id = auth.uid())
  OR
  -- Tasks in accessible spaces
  EXISTS (
    SELECT 1 FROM public.lists
    JOIN public.spaces ON spaces.id = lists.space_id
    WHERE lists.id = tasks.list_id
    AND (
      spaces.is_private = false
      OR EXISTS (
        SELECT 1 FROM public.space_members
        WHERE space_members.space_id = spaces.id
        AND space_members.user_id = auth.uid()
      )
    )
  )
);
```

### Example 2: QC Approval Gating Policy
Only QC Specialists, Managers, and Admins can transition a task into `READY_TO_DELIVER` (`QC - APPROVED (RTD)`).

```sql
CREATE POLICY "Only QC specialists can approve tasks"
ON public.tasks
FOR UPDATE
USING (
  -- Can update if authorized
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST')
  )
  OR
  -- Editors can update their own task UNLESS transitioning to QC Approved
  (
    assigned_editor_id = auth.uid()
    AND (
      SELECT category FROM public.statuses WHERE id = tasks.status_id
    ) NOT IN ('READY_TO_DELIVER', 'COMPLETED')
  )
);
```

### Example 3: Financial Privacy Policy
Editor rate columns (`payment_amount`, `payment_status`) must be protected so editors cannot view other editors' pay rates.

```sql
-- Handled via Postgres Column-Level Security or a secure View:
CREATE OR REPLACE VIEW public.v_tasks_sanitized AS
SELECT 
  t.id,
  t.list_id,
  t.title,
  t.description,
  t.status_id,
  t.priority_id,
  t.assigned_editor_id,
  t.assigned_qc_id,
  t.due_date,
  t.client_deadline,
  t.review_link,
  t.final_export_link,
  -- Mask payment amount unless user is manager/admin or the assigned editor
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE p.id = auth.uid() 
      AND p.role IN ('OWNER', 'ADMIN', 'PRODUCTION_MANAGER')
    ) THEN t.payment_amount
    WHEN t.assigned_editor_id = auth.uid() THEN t.payment_amount
    ELSE NULL 
  END AS payment_amount
FROM public.tasks t;
```

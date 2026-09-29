# TBB Workspace V2 — Database Schema Specification & Proposal
**Document ID:** `docs/TBB_DATABASE_PROPOSAL.md`  
**Date:** September 30, 2026  
**Target Engine:** PostgreSQL 15+ (Supabase)  
**Status:** Architecture Proposal (Read-Only Blueprint — No Migrations Applied in Phase 1)  

---

## 1. Entity-Relationship Overview

The proposed schema replaces the legacy 4-table flat prototype with a fully normalized 6-level hierarchy: Workspace → Space → Folder → List → Task → Subtask designed specifically for Think Big Brand (TBB).

```
[workspaces] 1 ──< [spaces] 1 ──< [folders] 0..1 ──< [lists] 1 ──< [tasks] 1 ──< [subtasks]
     │                                                    │            │
     ├──< [workspace_members]                             ├──< [workflows] ├──< [task_assignees]
     │                                                    │            ├──< [comments]
     ├──< [teams] 1 ──< [team_members]                    │            ├──< [attachments]
     │                                                    └──< [statuses]├──< [custom_field_values]
     └──< [activity_logs]                                              ├──< [task_dependencies]
```

---

## 2. Core Organizational & Identity Tables

### 2.1 `profiles` (User Profiles)
Stores extended user metadata linked 1-to-1 with Supabase `auth.users`.

```sql
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  role VARCHAR(50) NOT NULL DEFAULT 'EDITOR' CHECK (role IN (
    'OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST', 'EDITOR', 'CLIENT_VIEWER'
  )),
  phone VARCHAR(50),
  timezone VARCHAR(50) DEFAULT 'UTC',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2.2 `workspaces` (Root Agency Entity)
```sql
CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  logo_url TEXT,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2.3 `workspace_members` (Workspace Membership & Roles)
```sql
CREATE TABLE public.workspace_members (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'EDITOR',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);
```

### 2.4 `teams` (Creative Pods / Editing Teams)
Enables grouping editors and QC specialists under lead producers (e.g. *Pod Zim*, *Pod Myla*).

```sql
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  lead_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.team_members (
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'MEMBER',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);
```

---

## 3. Structural Hierarchy (Spaces, Folders, Lists)

### 3.1 `spaces` (Operational Departments)
```sql
CREATE TABLE public.spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  icon VARCHAR(50) DEFAULT 'folder',
  color VARCHAR(50) DEFAULT '#7B68EE',
  is_private BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, slug)
);
```

### 3.2 `folders` (Client Pods & Pipelines)
Example records: *CONTENT PIPELINE - ZIM*, *CONTENT PIPELINE - MYLA*.

```sql
CREATE TABLE public.folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_collapsed_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.3 `lists` (Client Deliverable Queues)
Example records: *25. EDAPTX*, *50. THE DESIRE COMPANY*, *18. SOCIAL CREWE MEDIA*.

```sql
CREATE TABLE public.lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL,
  workflow_id UUID REFERENCES public.workflows(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  color VARCHAR(50) DEFAULT '#7B68EE',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 4. Configurable Workflow & Status Tables

### 4.1 `workflows` & `statuses`
Eliminates hardcoded status enums. Each list can bind to a workflow containing custom pipeline stages.

```sql
CREATE TABLE public.workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL CHECK (category IN (
    'NOT_STARTED', 'IN_PROGRESS', 'IN_QC', 'READY_TO_DELIVER', 'CLIENT_REVIEW', 'COMPLETED'
  )),
  color VARCHAR(50) NOT NULL DEFAULT '#64748B',
  sort_order INT NOT NULL DEFAULT 0,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  requires_qc_approval BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.2 `priorities`
```sql
CREATE TABLE public.priorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  level INT NOT NULL UNIQUE,
  color VARCHAR(50) NOT NULL,
  icon VARCHAR(50) DEFAULT 'flag'
);
```

---

## 5. Tasks, Subtasks & Deliverables

### 5.1 `tasks` (Video Deliverables)
```sql
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE, -- Supports Subtasks
  title VARCHAR(500) NOT NULL,
  description TEXT,
  status_id UUID NOT NULL REFERENCES public.statuses(id) ON DELETE RESTRICT,
  priority_id UUID NOT NULL REFERENCES public.priorities(id) ON DELETE RESTRICT,
  
  -- Specialized Video Deliverable Fields
  assigned_editor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_qc_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  aspect_ratio VARCHAR(50) DEFAULT '9:16' CHECK (aspect_ratio IN ('9:16', '16:9', '1:1', '4:5', 'OTHER')),
  
  -- Cloud Video Links
  raw_footage_link TEXT,
  project_file_link TEXT,
  review_link TEXT,       -- Frame.io / Vimeo link
  final_export_link TEXT,  -- Google Drive / Master deliverable link
  
  -- Deadlines & Revisions
  due_date TIMESTAMPTZ,            -- Internal QC deadline
  client_deadline TIMESTAMPTZ,     -- Hard client delivery deadline
  revision_count INT NOT NULL DEFAULT 0,
  
  -- Editor Rate & Financials
  payment_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  payment_status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'QC_APPROVED', 'PAID')),
  payment_paid_at TIMESTAMPTZ,
  
  -- Ordering & Audit
  sort_order INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Essential Performance Indexes
CREATE INDEX idx_tasks_list_status ON public.tasks(list_id, status_id, sort_order);
CREATE INDEX idx_tasks_assigned_editor ON public.tasks(assigned_editor_id, status_id);
CREATE INDEX idx_tasks_assigned_qc ON public.tasks(assigned_qc_id, status_id);
CREATE INDEX idx_tasks_client_deadline ON public.tasks(client_deadline);
CREATE INDEX idx_tasks_parent_id ON public.tasks(parent_id);
```

### 5.2 `task_assignees` (Multiple Assignees Support)
```sql
CREATE TABLE public.task_assignees (
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_type VARCHAR(50) NOT NULL DEFAULT 'EDITOR' CHECK (role_type IN ('EDITOR', 'QC_REVIEWER', 'CREATIVE_DIRECTOR', 'VIEWER')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, user_id, role_type)
);
```

### 5.3 `task_dependencies` (Order of Operations)
```sql
CREATE TABLE public.task_dependencies (
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  depends_on_task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  dependency_type VARCHAR(50) NOT NULL DEFAULT 'BLOCKS',
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id != depends_on_task_id)
);
```

---

## 6. Collaboration, Activity & Extensibility

### 6.1 `comments` (Timestamped Threaded Feedback)
```sql
CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  video_timestamp VARCHAR(20), -- e.g. "01:24" for video-specific feedback
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 6.2 `attachments` (Media & Documents)
```sql
CREATE TABLE public.attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type VARCHAR(100),
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 6.3 `activity_logs` (Automated Audit Trail)
```sql
CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action_type VARCHAR(100) NOT NULL, -- 'STATUS_CHANGE', 'EDITOR_ASSIGNED', 'QC_APPROVED', etc.
  field_name VARCHAR(100),
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_logs_task ON public.activity_logs(task_id, created_at DESC);
```

### 6.4 `notifications` (User Action Inboxes)
```sql
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- 'ASSIGNED', 'QC_SUBMISSION', 'REVISION_REQUESTED', 'COMMENT'
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id, is_read, created_at DESC);
```

### 6.5 `custom_fields` & `custom_field_values`
Allows TBB managers to attach custom columns (e.g., *Sponsor Name*, *Voiceover Artist*, *Color LUT Profile*) to any List.

```sql
CREATE TABLE public.custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  field_type VARCHAR(50) NOT NULL CHECK (field_type IN ('TEXT', 'NUMBER', 'DROPDOWN', 'URL', 'DATE', 'CURRENCY')),
  options JSONB, -- For dropdown choices
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.custom_field_values (
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES public.custom_fields(id) ON DELETE CASCADE,
  value_text TEXT,
  value_numeric DECIMAL(12, 4),
  value_json JSONB,
  PRIMARY KEY (task_id, field_id)
);
```

# TBB Workspace V2 — Product & System Requirements Specification
**Document ID:** `docs/TBB_REQUIREMENTS.md`  
**Date:** September 30, 2026  
**Audience:** Think Big Brand (TBB) Engineering & Operations Leadership  
**Target User Base:** Internal TBB Team (~100 Concurrent Active Users)  
**System Class:** High-Velocity Internal Video Production & Creative Operations Platform  

---

## 1. Product Vision & Operating Context

**Think Big Brand (TBB)** is an elite digital content and video-editing agency producing high volumes of short-form and long-form video content across dozens of simultaneous client accounts. 

### Why TBB Workspace is NOT a Public SaaS
TBB Workspace is **strictly an internal operating system**. This architectural constraint fundamentally shapes all requirements:
1. **Zero Multi-Tenant Complexity:** No billing subscriptions, trial periods, public self-signup flows, or tenant-isolation overhead.
2. **Extreme Information Density:** Production managers, lead editors, and QC specialists review hundreds of tasks daily. Whitespace-heavy consumer layouts reduce efficiency. The UI must match the compact, high-density utility of ClickUp 3.0.
3. **Sub-100ms Response Times:** Switching between views, checking off tasks, or changing statuses must be instantaneous.
4. **Tailored Production Semantics:** First-class fields for raw footage, project files, Frame.io links, aspect ratios, editor compensation, QC revisions, and client delivery handoffs.

---

## 2. Information Architecture & Structural Hierarchy

TBB organizes its workload through a proven 6-level hierarchy: Workspace → Space → Folder → List → Task → Subtask inspired by ClickUp. Every task lives within a strict, logical path:

```
[ TBB Workspace ] (Root Organization)
       │
       ├── [ Space: Content Pipelines ] (Major operational domain)
       │         │
       │         ├── [ Folder: CONTENT PIPELINE - ZIM ] (Client pod or producer group)
       │         │         │
       │         │         ├── [ List: 2. CONOR CONTENT ] (Active deliverables list)
       │         │         ├── [ List: 3. LOCALKICKS CONTENT ]
       │         │         └── [ List: 6. JOHN PEREZ CONTENT ]
       │         │
       │         └── [ Folder: CONTENT PIPELINE - MYLA ]
       │                   │
       │                   ├── [ List: 18. SOCIAL CREWE MEDIA ]
       │                   ├── [ List: 21. WHOOSH MEDIA ]
       │                   ├── [ List: 23. LIST-VANTAGE ]
       │                   ├── [ List: 25. EDAPTX ]
       │                   ├── [ List: 27. COLE MAGER ]
       │                   ├── [ List: 35. ASCENVI ]
       │                   ├── [ List: 40. DANIELA SARSHALOM ]
       │                   ├── [ List: 44. FULLBARS MEDIA ]
       │                   ├── [ List: 46. JOE RAGO ]
       │                   └── [ List: 50. THE DESIRE COMPANY ]
       │
       ├── [ Space: Creative Strategy & Scripts ]
       └── [ Space: Internal Agency Operations ]
```

### Hierarchy Definitions:
* **Workspace:** The root entity (Think Big Brand). Contains all users, permissions, global settings, and spaces.
* **Space:** High-level operational departments (e.g., *Content Pipelines*, *Creative Strategy*, *Client Portals*). Configures default workflows and features.
* **Folder:** Dedicated container for client pods or lead producers (e.g., *CONTENT PIPELINE - ZIM*, *CONTENT PIPELINE - MYLA*).
* **List:** Individual client or brand content queues (e.g., *25. EDAPTX*, *50. THE DESIRE COMPANY*). Tasks belong directly to a list.
* **Task:** An individual video deliverable (e.g., *Ep. 14 — Hooks Testing (9:16)*).
* **Subtask:** Discrete production steps under a task (e.g., *Sound Design*, *Captions & B-Roll*, *Client Color Revisions*).

---

## 3. Production Workflow & Status Engine Requirements

TBB’s production engine requires a flexible, non-hardcoded workflow state machine. Each list can inherit or customize its workflow.

### TBB Production Pipeline Reference Statuses:
```
[ TO BE EDITED ] ──────────► [ ASSIGNED ] ──────────► [ STARTED EDITING ] ──────────► [ IN EDIT ]
                                                                                            │
                                                                                            ▼
                                                                                   [ QC - FIRST APPROVAL ]
                                                                                       │            ▲
                                                       Revisions Required              │            │
                                                       ┌───────────────────────────────┘            │
                                                       ▼                                            │
                                              [ QC - REVISION NEEDED ] ─────────────────────────────┘
                                                       │
                                                       ▼ (Revisions Complete)
                                              [ QC - FINAL APPROVAL ]
                                                       │
                                                       ▼ (Passed QC)
                                              [ QC - APPROVED (RTD) ]
                                                       │
                                                       ▼
                                              [ SENT TO CLIENT ]
                                                       │
                                                       ▼
                                                   [ CLOSED ]
```

### Workflow Rules:
1. **Configurable Status Model:** Statuses must **NEVER** be hardcoded as TypeScript enums or database CHECK constraints. Statuses belong to a `workflows` entity and are linked to lists.
2. **Category Grouping:** Every status must map to a standardized high-level category for global reporting:
   * `NOT_STARTED` (*TO BE EDITED*)
   * `IN_PROGRESS` (*ASSIGNED, STARTED EDITING, IN EDIT*)
   * `IN_REVIEW` (*QC - FIRST APPROVAL, QC - REVISION NEEDED, QC - FINAL APPROVAL*)
   * `READY` (*QC - APPROVED (RTD)*)
   * `CLIENT` (*SENT TO CLIENT*)
   * `COMPLETED` (*CLOSED*)
3. **Role Gating on Status Transitions:**
   * Only **QC Specialists** or **Admins** can move a task to `QC - APPROVED (RTD)` or `SENT TO CLIENT`.
   * An **Editor** moving a task out of `IN EDIT` is prompted to provide the preview link and automatically transitions the task to `QC - FIRST APPROVAL`.
   * If rejected by QC, the system requires a reason/timestamped revision note before moving to `QC - REVISION NEEDED`.

---

## 4. Video Deliverable Field Specifications

Every task representing a video deliverable requires specific, structured metadata:

| Field Name | Type | Description | Mandatory? |
| :--- | :--- | :--- | :---: |
| **Title** | String (255) | Name of video deliverable (e.g. `EDAPTX - Hook 3 Cutdown`) | Yes |
| **Description** | Rich Text / Markdown | Creative brief, script notes, talking points | No |
| **Status** | Foreign Key (`statuses.id`) | Current pipeline stage | Yes |
| **Priority** | Foreign Key (`priorities.id`)| Urgent (🔴), High (🟠), Normal (🔵), Low (⚪) | Yes |
| **Primary Editor** | Foreign Key (`users.id`) | Assigned video editor | No |
| **QC Reviewer** | Foreign Key (`users.id`) | Assigned quality control specialist | No |
| **Aspect Ratio** | Enum / Dropdown | `9:16 (Reels/TikTok)`, `16:9 (YouTube)`, `1:1`, `4:5` | Yes |
| **Raw Footage Link** | URL | Google Drive / Dropbox link to source footage | No |
| **Project File Link** | URL | Link to Premiere / DaVinci Resolve project (.prproj / .drp)| No |
| **Review Link** | URL | Frame.io / Vimeo review link | No |
| **Final Export Link**| URL | Master deliverable link (Google Drive / Frame.io) | No |
| **Internal QC Due Date** | Timestamp | Deadline for editor to submit first cut to QC | Yes |
| **Client Deadline** | Timestamp | Hard deadline to deliver to the client | Yes |
| **Revision Count** | Integer | Auto-incremented each time task enters `REVISION_NEEDED` | Default 0 |
| **Editor Pay Rate** | Decimal (10, 2) | Agreed editor payment for the video | No |
| **Payment Status** | Enum | `PENDING`, `QC_APPROVED`, `PAID` | Default PENDING |

---

## 5. Core Application Views

To match the operational demands of TBB, the interface must provide 4 distinct task views across every List, Folder, Space, and global "Everything" scope:

### 5.1 List View (Primary Operational View)
* High-density grouping by status with colored header banners and task counts.
* Collapse / expand accordions with state persistence in `localStorage`.
* Visible columns: Task Name, Assignee Avatar, QC Reviewer, Priority Flag, Aspect Ratio Pill, Internal Due Date, Client Deadline, Review Link icon, Editor Rate.
* Inline row creation: "+ Add Task" row at the bottom of every status group for rapid task entry.
* Quick batch actions: Multi-select tasks to batch change status, editor, or due date.

### 5.2 Board View (Kanban)
* Vertical columns corresponding to the active list's workflow statuses.
* Visual drag-and-drop powered by `@dnd-kit` with optimistic UI updates.
* Quick card metrics: Aspect ratio badge, revision indicator tag (`Rev #2`), assignee avatar, overdue warning color.
* Column headers with task counter and "+ Add" button.

### 5.3 Table View (Spreadsheet Grid)
* High-density grid inspired by ClickUp Table view.
* Inline cell editing (click status cell to trigger dropdown, click date to trigger date picker).
* Resizable and reorderable columns.
* Fast copy-pasting of Drive URLs directly into cells.

### 5.4 Calendar View
* Monthly and weekly grid plotting tasks based on `Client Deadline` or `Internal QC Due Date`.
* Color-coded status dots to identify bottlenecks on specific days.

---

## 6. Real-Time Collaboration & Communication

1. **Task Activity Feed:**
   * Immutable audit log of every change (status updates, assignee reassignments, date changes, link updates).
   * Exact timestamp, actor avatar, and visual diff (`changed status from IN EDIT to QC - FIRST APPROVAL`).
2. **Threaded Comments:**
   * Rich text comments with `@mentions` of team members.
   * Frame.io-style timestamp comments (e.g. `At 0:14, sound effect volume is too loud`).
3. **Internal Notifications:**
   * In-app notification center (bell icon with unread count).
   * Immediate notification triggers:
     * Editor assigned to a task.
     * Task moved to `QC - FIRST APPROVAL` (alerts assigned QC Reviewer).
     * Task moved to `QC - REVISION NEEDED` (alerts assigned Editor with feedback).
     * Task due date within 24 hours.

---

## 7. Performance & Usability Benchmarks

Because TBB manages thousands of active tasks across 50+ clients, the application must adhere to strict non-negotiable performance SLAs:
1. **Initial Page Load:** Under 1.5 seconds on standard broadband.
2. **List View Render Time:** Sub-100ms render for lists containing up to 1,000 tasks using virtual windowing (`@tanstack/react-virtual`).
3. **Optimistic Updates:** UI responds instantly (0ms perceived latency) when dragging cards or changing statuses; background sync handles network failures gracefully.
4. **Keyboard Accessibility:** Global keyboard shortcuts:
   * `Ctrl + K` / `Cmd + K`: Global Command Palette and fast search across all clients, lists, and tasks.
   * `C`: Open Quick Task modal.
   * `Esc`: Close open modal, drawer, or sheet.

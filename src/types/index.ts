
export enum UserRole {
  AUTHOR = "AUTHOR",
  EMPLOYEE = "EMPLOYEE"
}

export enum TaskStatus {
  TODO = "TODO",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  // New Kanban statuses
  NEW_REQUEST = "NEW_REQUEST",
  ASSIGNED = "ASSIGNED",
  IN_EDIT = "IN_EDIT",
  REVISION_NEEDED = "REVISION_NEEDED",
  FIRST_APPROVAL = "FIRST_APPROVAL",
  FINAL_APPROVAL = "FINAL_APPROVAL",
  FOR_CLIENT_APPROVAL = "FOR_CLIENT_APPROVAL"
}

export enum PaymentStatus {
  PENDING = "PENDING",
  PAID = "PAID"
}

export enum TaskPriority {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH"
}

export enum TaskLevel {
  JUNIOR = "JUNIOR",
  MID = "MID",
  SENIOR = "SENIOR"
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  members: string[];
  createdAt: Date;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignedTo: string;
  workspaceId: string;
  createdBy: string;
  dueDate: Date;
  createdAt: Date;
  completedAt?: Date;
  externalLink?: string;
  priority: TaskPriority;
  level: TaskLevel;
  payment: {
    amount: number;
    status: PaymentStatus;
    paidAt?: Date;
  };
}

export interface UserStats {
  tasksCompleted: number;
  tasksInProgress: number;
  tasksTodo: number;
  totalEarnings: number;
  paidEarnings: number;
  pendingEarnings: number;
}

export interface KanbanColumn {
  id: string;
  title: string;
  status: TaskStatus;
  tasks: Task[];
}

export interface DragItem {
  type: string;
  id: string;
  status: TaskStatus;
}

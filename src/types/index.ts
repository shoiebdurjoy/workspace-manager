
export enum UserRole {
  AUTHOR = "AUTHOR",
  EMPLOYEE = "EMPLOYEE"
}

export enum TaskStatus {
  TODO = "TODO",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED"
}

export enum PaymentStatus {
  PENDING = "PENDING",
  PAID = "PAID"
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

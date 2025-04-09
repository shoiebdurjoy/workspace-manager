
import { UserRole, TaskStatus, PaymentStatus, User, Workspace, Task, UserStats } from '@/types';

// Mock Users
export const mockUsers: User[] = [
  {
    id: '1',
    name: 'Jane Smith',
    email: 'admin@workwise.com',
    role: UserRole.AUTHOR,
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Jane'
  },
  {
    id: '2',
    name: 'John Doe',
    email: 'employee@workwise.com',
    role: UserRole.EMPLOYEE,
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=John'
  },
  {
    id: '3',
    name: 'Sarah Johnson',
    email: 'sarah@workwise.com',
    role: UserRole.EMPLOYEE,
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah'
  },
  {
    id: '4',
    name: 'Michael Brown',
    email: 'michael@workwise.com',
    role: UserRole.EMPLOYEE,
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Michael'
  },
  {
    id: '5',
    name: 'Emily Davis',
    email: 'emily@workwise.com',
    role: UserRole.EMPLOYEE,
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Emily'
  }
];

// Mock Workspaces
export const mockWorkspaces: Workspace[] = [
  {
    id: '1',
    name: 'Marketing Team',
    description: 'Team responsible for all marketing campaigns and strategies',
    createdBy: '1',
    members: ['1', '2', '3'],
    createdAt: new Date('2025-01-15')
  },
  {
    id: '2',
    name: 'Development Team',
    description: 'Software development and engineering team',
    createdBy: '1',
    members: ['1', '4', '5'],
    createdAt: new Date('2025-02-03')
  },
  {
    id: '3',
    name: 'Content Creation',
    description: 'Team focused on content writing and creation',
    createdBy: '1',
    members: ['1', '2', '5'],
    createdAt: new Date('2025-03-10')
  }
];

// Mock Tasks
export const mockTasks: Task[] = [
  {
    id: '1',
    title: 'Create Social Media Campaign',
    description: 'Design and plan Q2 social media marketing campaign',
    status: TaskStatus.COMPLETED,
    assignedTo: '2',
    workspaceId: '1',
    createdBy: '1',
    dueDate: new Date('2025-04-05'),
    createdAt: new Date('2025-03-20'),
    completedAt: new Date('2025-04-02'),
    payment: {
      amount: 250,
      status: PaymentStatus.PAID,
      paidAt: new Date('2025-04-10')
    }
  },
  {
    id: '2',
    title: 'Develop Landing Page',
    description: 'Create new product landing page with responsive design',
    status: TaskStatus.IN_PROGRESS,
    assignedTo: '4',
    workspaceId: '2',
    createdBy: '1',
    dueDate: new Date('2025-04-15'),
    createdAt: new Date('2025-03-25'),
    payment: {
      amount: 350,
      status: PaymentStatus.PENDING
    }
  },
  {
    id: '3',
    title: 'Write Blog Articles',
    description: 'Create 5 blog articles about industry trends',
    status: TaskStatus.COMPLETED,
    assignedTo: '5',
    workspaceId: '3',
    createdBy: '1',
    dueDate: new Date('2025-04-08'),
    createdAt: new Date('2025-03-22'),
    completedAt: new Date('2025-04-07'),
    payment: {
      amount: 200,
      status: PaymentStatus.PAID,
      paidAt: new Date('2025-04-12')
    }
  },
  {
    id: '4',
    title: 'Design Product Mockups',
    description: 'Create mockups for the new product lineup',
    status: TaskStatus.TODO,
    assignedTo: '3',
    workspaceId: '1',
    createdBy: '1',
    dueDate: new Date('2025-04-20'),
    createdAt: new Date('2025-03-30'),
    payment: {
      amount: 300,
      status: PaymentStatus.PENDING
    }
  },
  {
    id: '5',
    title: 'Fix Website Bugs',
    description: 'Address reported bugs on the company website',
    status: TaskStatus.IN_PROGRESS,
    assignedTo: '4',
    workspaceId: '2',
    createdBy: '1',
    dueDate: new Date('2025-04-11'),
    createdAt: new Date('2025-04-01'),
    payment: {
      amount: 150,
      status: PaymentStatus.PENDING
    }
  },
  {
    id: '6',
    title: 'SEO Optimization',
    description: 'Improve website SEO for better search rankings',
    status: TaskStatus.COMPLETED,
    assignedTo: '2',
    workspaceId: '1',
    createdBy: '1',
    dueDate: new Date('2025-04-05'),
    createdAt: new Date('2025-03-15'),
    completedAt: new Date('2025-04-03'),
    payment: {
      amount: 200,
      status: PaymentStatus.PENDING
    }
  },
  {
    id: '7',
    title: 'Write Product Documentation',
    description: 'Create comprehensive documentation for new features',
    status: TaskStatus.TODO,
    assignedTo: '5',
    workspaceId: '3',
    createdBy: '1',
    dueDate: new Date('2025-04-25'),
    createdAt: new Date('2025-04-05'),
    payment: {
      amount: 250,
      status: PaymentStatus.PENDING
    }
  },
  {
    id: '8',
    title: 'Email Newsletter Design',
    description: 'Design the monthly email newsletter template',
    status: TaskStatus.COMPLETED,
    assignedTo: '3',
    workspaceId: '1',
    createdBy: '1',
    dueDate: new Date('2025-04-02'),
    createdAt: new Date('2025-03-20'),
    completedAt: new Date('2025-04-01'),
    payment: {
      amount: 100,
      status: PaymentStatus.PAID,
      paidAt: new Date('2025-04-05')
    }
  }
];

// Calculate user stats
export const getUserStats = (userId: string): UserStats => {
  const userTasks = mockTasks.filter(task => task.assignedTo === userId);
  
  const tasksCompleted = userTasks.filter(task => task.status === TaskStatus.COMPLETED).length;
  const tasksInProgress = userTasks.filter(task => task.status === TaskStatus.IN_PROGRESS).length;
  const tasksTodo = userTasks.filter(task => task.status === TaskStatus.TODO).length;
  
  const totalEarnings = userTasks.reduce((sum, task) => sum + task.payment.amount, 0);
  const paidEarnings = userTasks
    .filter(task => task.payment.status === PaymentStatus.PAID)
    .reduce((sum, task) => sum + task.payment.amount, 0);
  const pendingEarnings = totalEarnings - paidEarnings;
  
  return {
    tasksCompleted,
    tasksInProgress,
    tasksTodo,
    totalEarnings,
    paidEarnings,
    pendingEarnings
  };
};

export const getWorkspacesForUser = (userId: string): Workspace[] => {
  return mockWorkspaces.filter(workspace => workspace.members.includes(userId));
};

export const getTasksForUser = (userId: string): Task[] => {
  return mockTasks.filter(task => task.assignedTo === userId || task.createdBy === userId);
};

export const getTasksForWorkspace = (workspaceId: string): Task[] => {
  return mockTasks.filter(task => task.workspaceId === workspaceId);
};

export const getUserById = (userId: string): User | undefined => {
  return mockUsers.find(user => user.id === userId);
};

export const getWorkspaceById = (workspaceId: string): Workspace | undefined => {
  return mockWorkspaces.find(workspace => workspace.id === workspaceId);
};

export const getTaskById = (taskId: string): Task | undefined => {
  return mockTasks.find(task => task.id === taskId);
};


import { UserRole, TaskStatus, PaymentStatus, User, Workspace, Task, TaskPriority, TaskLevel, UserStats } from '@/types';

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
    priority: TaskPriority.HIGH,
    level: TaskLevel.SENIOR,
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
    status: TaskStatus.IN_EDIT,
    assignedTo: '4',
    workspaceId: '2',
    createdBy: '1',
    dueDate: new Date('2025-04-15'),
    createdAt: new Date('2025-03-25'),
    priority: TaskPriority.MEDIUM,
    level: TaskLevel.MID,
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
    priority: TaskPriority.MEDIUM,
    level: TaskLevel.SENIOR,
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
    status: TaskStatus.NEW_REQUEST,
    assignedTo: '3',
    workspaceId: '1',
    createdBy: '1',
    dueDate: new Date('2025-04-20'),
    createdAt: new Date('2025-03-30'),
    priority: TaskPriority.LOW,
    level: TaskLevel.JUNIOR,
    payment: {
      amount: 300,
      status: PaymentStatus.PENDING
    }
  },
  {
    id: '5',
    title: 'Fix Website Bugs',
    description: 'Address reported bugs on the company website',
    status: TaskStatus.REVISION_NEEDED,
    assignedTo: '4',
    workspaceId: '2',
    createdBy: '1',
    dueDate: new Date('2025-04-11'),
    createdAt: new Date('2025-04-01'),
    priority: TaskPriority.HIGH,
    level: TaskLevel.MID,
    payment: {
      amount: 150,
      status: PaymentStatus.PENDING
    }
  },
  {
    id: '6',
    title: 'SEO Optimization',
    description: 'Improve website SEO for better search rankings',
    status: TaskStatus.ASSIGNED,
    assignedTo: '2',
    workspaceId: '1',
    createdBy: '1',
    dueDate: new Date('2025-04-05'),
    createdAt: new Date('2025-03-15'),
    priority: TaskPriority.MEDIUM,
    level: TaskLevel.JUNIOR,
    payment: {
      amount: 200,
      status: PaymentStatus.PENDING
    }
  },
  {
    id: '7',
    title: 'Write Product Documentation',
    description: 'Create comprehensive documentation for new features',
    status: TaskStatus.NEW_REQUEST,
    assignedTo: '5',
    workspaceId: '3',
    createdBy: '1',
    dueDate: new Date('2025-04-25'),
    createdAt: new Date('2025-04-05'),
    priority: TaskPriority.LOW,
    level: TaskLevel.MID,
    payment: {
      amount: 250,
      status: PaymentStatus.PENDING
    }
  },
  {
    id: '8',
    title: 'Email Newsletter Design',
    description: 'Design the monthly email newsletter template',
    status: TaskStatus.FINAL_APPROVAL,
    assignedTo: '3',
    workspaceId: '1',
    createdBy: '1',
    dueDate: new Date('2025-04-02'),
    createdAt: new Date('2025-03-20'),
    priority: TaskPriority.MEDIUM,
    level: TaskLevel.JUNIOR,
    payment: {
      amount: 100,
      status: PaymentStatus.PENDING
    }
  },
  {
    id: '9',
    title: 'Client Presentation',
    description: 'Prepare presentation for the client meeting next week',
    status: TaskStatus.FOR_CLIENT_APPROVAL,
    assignedTo: '2',
    workspaceId: '1',
    createdBy: '1',
    dueDate: new Date('2025-04-18'),
    createdAt: new Date('2025-04-08'),
    priority: TaskPriority.HIGH,
    level: TaskLevel.SENIOR,
    payment: {
      amount: 300,
      status: PaymentStatus.PENDING
    }
  },
  {
    id: '10',
    title: 'Competitor Analysis',
    description: 'Research and analyze top 5 competitors in the market',
    status: TaskStatus.FIRST_APPROVAL,
    assignedTo: '3',
    workspaceId: '3',
    createdBy: '1',
    dueDate: new Date('2025-04-22'),
    createdAt: new Date('2025-04-07'),
    priority: TaskPriority.MEDIUM,
    level: TaskLevel.MID,
    payment: {
      amount: 200,
      status: PaymentStatus.PENDING
    }
  }
];

// Calculate user stats
export const getUserStats = (userId: string): UserStats => {
  const userTasks = mockTasks.filter(task => task.assignedTo === userId);
  
  const tasksCompleted = userTasks.filter(task => task.status === TaskStatus.COMPLETED).length;
  const tasksInProgress = userTasks.filter(task => 
    task.status !== TaskStatus.COMPLETED && 
    task.status !== TaskStatus.NEW_REQUEST
  ).length;
  const tasksTodo = userTasks.filter(task => task.status === TaskStatus.NEW_REQUEST).length;
  
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

// Get workspaces for user
export const getWorkspacesForUser = (userId: string): Workspace[] => {
  return mockWorkspaces.filter(workspace => workspace.members.includes(userId));
};

// Get tasks for user
export const getTasksForUser = (userId: string): Task[] => {
  return mockTasks.filter(task => task.assignedTo === userId || task.createdBy === userId);
};

// Get tasks for workspace
export const getTasksForWorkspace = (workspaceId: string): Task[] => {
  return mockTasks.filter(task => task.workspaceId === workspaceId);
};

// Get user by ID
export const getUserById = (userId: string): User | undefined => {
  return mockUsers.find(user => user.id === userId);
};

// Get workspace by ID
export const getWorkspaceById = (workspaceId: string): Workspace | undefined => {
  return mockWorkspaces.find(workspace => workspace.id === workspaceId);
};

// Get task by ID
export const getTaskById = (taskId: string): Task | undefined => {
  return mockTasks.find(task => task.id === taskId);
};

// Create a new workspace
export const createWorkspace = (workspaceData: Omit<Workspace, 'id' | 'createdAt'>): Workspace => {
  const newWorkspace: Workspace = {
    id: `workspace_${Date.now()}`,
    ...workspaceData,
    createdAt: new Date()
  };
  
  mockWorkspaces.push(newWorkspace);
  return newWorkspace;
};

// Create a new task
export const createTask = (taskData: Omit<Task, 'id' | 'createdAt' | 'status'>): Task => {
  const newTask: Task = {
    id: `task_${Date.now()}`,
    status: TaskStatus.NEW_REQUEST, // Default status for new tasks
    createdAt: new Date(),
    ...taskData,
  };
  
  mockTasks.push(newTask);
  return newTask;
};

// Update task status
export const updateTaskStatus = (taskId: string, newStatus: TaskStatus): Task => {
  const taskIndex = mockTasks.findIndex(task => task.id === taskId);
  
  if (taskIndex === -1) {
    throw new Error(`Task with id ${taskId} not found`);
  }
  
  // Create a copy of the task with the updated status
  const updatedTask = {
    ...mockTasks[taskIndex],
    status: newStatus,
    ...(newStatus === TaskStatus.COMPLETED ? { completedAt: new Date() } : {})
  };
  
  // Update the task in the mock data
  mockTasks[taskIndex] = updatedTask;
  
  return updatedTask;
};

// Update task payment status
export const updateTaskPaymentStatus = (taskId: string, newStatus: PaymentStatus): Task => {
  const taskIndex = mockTasks.findIndex(task => task.id === taskId);
  
  if (taskIndex === -1) {
    throw new Error(`Task with id ${taskId} not found`);
  }
  
  // Create a copy of the task with the updated payment status
  const updatedTask = {
    ...mockTasks[taskIndex],
    payment: {
      ...mockTasks[taskIndex].payment,
      status: newStatus,
      ...(newStatus === PaymentStatus.PAID ? { paidAt: new Date() } : { paidAt: undefined })
    }
  };
  
  // Update the task in the mock data
  mockTasks[taskIndex] = updatedTask;
  
  return updatedTask;
};

// Get monthly stats for a user
export const getMonthlyStats = (userId: string): { month: string; completed: number; earnings: number }[] => {
  const userTasks = mockTasks.filter(task => task.assignedTo === userId);
  
  const monthlyStats: Record<string, { completed: number; earnings: number }> = {};
  
  // Initialize with last 6 months
  const today = new Date();
  for (let i = 0; i < 6; i++) {
    const month = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const monthKey = `${month.getFullYear()}-${month.getMonth() + 1}`;
    const monthName = month.toLocaleString('default', { month: 'short' });
    monthlyStats[monthName] = { completed: 0, earnings: 0 };
  }
  
  // Fill in data from tasks
  userTasks.forEach(task => {
    if (task.completedAt) {
      const month = task.completedAt.toLocaleString('default', { month: 'short' });
      if (monthlyStats[month]) {
        monthlyStats[month].completed += 1;
        monthlyStats[month].earnings += task.payment.amount;
      }
    }
  });
  
  return Object.entries(monthlyStats).map(([month, stats]) => ({
    month,
    ...stats
  })).reverse();
};

// Save task data to localStorage to persist between reloads
export const saveTasksToLocalStorage = (): void => {
  localStorage.setItem('workwise_tasks', JSON.stringify(mockTasks));
};

// Load tasks from localStorage
export const loadTasksFromLocalStorage = (): void => {
  const savedTasks = localStorage.getItem('workwise_tasks');
  if (savedTasks) {
    try {
      const parsedTasks = JSON.parse(savedTasks);
      // Convert string dates back to Date objects
      const fixedTasks = parsedTasks.map((task: any) => ({
        ...task,
        dueDate: new Date(task.dueDate),
        createdAt: new Date(task.createdAt),
        completedAt: task.completedAt ? new Date(task.completedAt) : undefined,
        payment: {
          ...task.payment,
          paidAt: task.payment.paidAt ? new Date(task.payment.paidAt) : undefined
        }
      }));
      // Replace the mock tasks with the saved tasks
      mockTasks.length = 0;
      mockTasks.push(...fixedTasks);
    } catch (error) {
      console.error('Failed to parse saved tasks:', error);
    }
  }
};

// Initialize - load saved tasks on module import
try {
  loadTasksFromLocalStorage();
} catch (error) {
  console.error('Error loading tasks from localStorage:', error);
}

import React from 'react';
import OverviewStats from '@/components/dashboard/OverviewStats';
import RecentTasks from '@/components/dashboard/RecentTasks';
import WorkspacesList from '@/components/dashboard/WorkspacesList';
import { useAuth } from '@/context/AuthContext';
import { 
  getWorkspacesForUser, 
  getTasksForUser, 
  getUserStats, 
  mockUsers 
} from '@/services/mockData';
import { UserRole } from '@/types';
import { Sparkles } from 'lucide-react';

const Dashboard: React.FC = () => {
  const { currentUser } = useAuth();

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse flex items-center gap-2 text-muted-foreground">
          <Sparkles className="h-5 w-5 animate-float" />
          Loading...
        </div>
      </div>
    );
  }

  const isAuthor = currentUser.role === UserRole.AUTHOR;
  
  const userWorkspaces = getWorkspacesForUser(currentUser.id);
  const userTasks = getTasksForUser(currentUser.id);
  const userStats = getUserStats(currentUser.id);

  const totalPendingPayments = isAuthor 
    ? userTasks
      .filter(task => task.payment.status === 'PENDING')
      .reduce((sum, task) => sum + task.payment.amount, 0)
    : 0;

  return (
    <div className="space-y-8 animate-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back, <span className="text-foreground font-medium">{currentUser.name}</span>! 👋
          </p>
        </div>
      </div>

      <OverviewStats
        tasksCompleted={userStats.tasksCompleted}
        tasksInProgress={userStats.tasksInProgress}
        tasksTodo={userStats.tasksTodo}
        totalEarnings={userStats.totalEarnings}
        pendingPayments={totalPendingPayments}
        isAuthor={isAuthor}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentTasks tasks={userTasks} users={mockUsers} />
        <WorkspacesList workspaces={userWorkspaces} />
      </div>
    </div>
  );
};

export default Dashboard;

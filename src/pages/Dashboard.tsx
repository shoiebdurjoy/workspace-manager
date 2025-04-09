
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

const Dashboard: React.FC = () => {
  const { currentUser } = useAuth();

  // If currentUser is null, we can return early or show a loading state
  if (!currentUser) {
    return <div className="flex items-center justify-center h-full">Loading...</div>;
  }

  const isAuthor = currentUser.role === UserRole.AUTHOR;
  
  // Get data for the current user
  const userWorkspaces = getWorkspacesForUser(currentUser.id);
  const userTasks = getTasksForUser(currentUser.id);
  const userStats = getUserStats(currentUser.id);

  // For admin, calculate total pending payments
  const totalPendingPayments = isAuthor 
    ? userTasks
      .filter(task => task.payment.status === 'PENDING')
      .reduce((sum, task) => sum + task.payment.amount, 0)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back, {currentUser.name}!
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

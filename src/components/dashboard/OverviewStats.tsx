
import React from 'react';
import { Check, Clock, ListChecks, DollarSign } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface StatsCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

const StatsCard: React.FC<StatsCardProps> = ({ title, value, description, icon, trend }) => {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className="w-8 h-8 flex items-center justify-center rounded-full bg-muted">
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        {trend && (
          <div className="flex items-center mt-1">
            <span className={`text-xs ${trend.isPositive ? 'text-green-500' : 'text-red-500'}`}>
              {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}%
            </span>
            <span className="text-xs text-muted-foreground ml-1">from last month</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

interface OverviewStatsProps {
  tasksCompleted: number;
  tasksInProgress: number;
  tasksTodo: number;
  totalEarnings?: number;
  pendingPayments?: number;
  isAuthor?: boolean;
}

const OverviewStats: React.FC<OverviewStatsProps> = ({
  tasksCompleted,
  tasksInProgress,
  tasksTodo,
  totalEarnings = 0,
  pendingPayments = 0,
  isAuthor = false,
}) => {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatsCard
        title="Tasks Completed"
        value={tasksCompleted}
        icon={<Check className="h-4 w-4 text-muted-foreground" />}
        trend={{ value: 12, isPositive: true }}
      />
      <StatsCard
        title="In Progress"
        value={tasksInProgress}
        icon={<Clock className="h-4 w-4 text-muted-foreground" />}
      />
      <StatsCard
        title="To Do"
        value={tasksTodo}
        icon={<ListChecks className="h-4 w-4 text-muted-foreground" />}
      />
      <StatsCard
        title={isAuthor ? "Pending Payments" : "Total Earnings"}
        value={`$${isAuthor ? pendingPayments : totalEarnings}`}
        icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
      />
    </div>
  );
};

export default OverviewStats;

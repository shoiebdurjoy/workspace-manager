import React from 'react';
import { Check, Clock, ListChecks, DollarSign, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ReactNode;
  iconColor?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

const StatsCard: React.FC<StatsCardProps> = ({ title, value, description, icon, iconColor, trend }) => {
  return (
    <Card className="group hover-lift overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight">{value}</span>
              {trend && (
                <span className={cn(
                  "flex items-center text-xs font-medium px-2 py-0.5 rounded-full",
                  trend.isPositive 
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" 
                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                )}>
                  {trend.isPositive ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                  {Math.abs(trend.value)}%
                </span>
              )}
            </div>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          <div className={cn(
            "flex items-center justify-center h-12 w-12 rounded-xl transition-all duration-300 group-hover:scale-110",
            iconColor || "bg-primary/10"
          )}>
            {icon}
          </div>
        </div>
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
        icon={<Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />}
        iconColor="bg-emerald-100 dark:bg-emerald-900/30"
        trend={{ value: 12, isPositive: true }}
      />
      <StatsCard
        title="In Progress"
        value={tasksInProgress}
        icon={<Clock className="h-6 w-6 text-blue-600 dark:text-blue-400" />}
        iconColor="bg-blue-100 dark:bg-blue-900/30"
      />
      <StatsCard
        title="To Do"
        value={tasksTodo}
        icon={<ListChecks className="h-6 w-6 text-amber-600 dark:text-amber-400" />}
        iconColor="bg-amber-100 dark:bg-amber-900/30"
      />
      <StatsCard
        title={isAuthor ? "Pending Payments" : "Total Earnings"}
        value={`$${isAuthor ? pendingPayments.toLocaleString() : totalEarnings.toLocaleString()}`}
        icon={<DollarSign className="h-6 w-6 text-violet-600 dark:text-violet-400" />}
        iconColor="bg-violet-100 dark:bg-violet-900/30"
      />
    </div>
  );
};

export default OverviewStats;

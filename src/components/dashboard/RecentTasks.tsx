import React from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Task, TaskStatus, User } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ArrowRight, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RecentTasksProps {
  tasks: Task[];
  users: User[];
  maxItems?: number;
}

const getStatusBadgeStyles = (status: TaskStatus) => {
  switch (status) {
    case TaskStatus.COMPLETED:
      return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800';
    case TaskStatus.IN_PROGRESS:
      return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800';
    case TaskStatus.TODO:
      return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

const getStatusText = (status: TaskStatus) => {
  switch (status) {
    case TaskStatus.COMPLETED:
      return 'Completed';
    case TaskStatus.IN_PROGRESS:
      return 'In Progress';
    case TaskStatus.TODO:
      return 'To Do';
    default:
      return status;
  }
};

const RecentTasks: React.FC<RecentTasksProps> = ({ tasks, users, maxItems = 5 }) => {
  const recentTasks = [...tasks]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, maxItems);

  const getUserByID = (id: string): User | undefined => {
    return users.find(user => user.id === id);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Tasks</CardTitle>
        <CardDescription>Latest tasks from all workspaces</CardDescription>
      </CardHeader>
      <CardContent className="px-2">
        <div className="space-y-1">
          {recentTasks.map((task, index) => {
            const assignee = getUserByID(task.assignedTo);
            return (
              <div
                key={task.id}
                className={cn(
                  "flex items-center justify-between p-3 rounded-xl transition-all duration-200 hover:bg-muted/50 group cursor-pointer",
                  "animate-in"
                )}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <Badge
                    variant="outline"
                    className={cn("shrink-0 font-medium text-xs", getStatusBadgeStyles(task.status))}
                  >
                    {getStatusText(task.status)}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors duration-200">
                      {task.title}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Calendar className="h-3 w-3" />
                      Due {format(new Date(task.dueDate), 'MMM dd, yyyy')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {assignee && (
                    <Avatar className="h-8 w-8 ring-2 ring-background">
                      <AvatarImage src={assignee.avatarUrl} />
                      <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-primary-foreground text-xs font-medium">
                        {assignee.name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-200" />
                </div>
              </div>
            );
          })}

          {recentTasks.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">No tasks found.</p>
          )}
        </div>
      </CardContent>
      <CardFooter>
        <Button asChild variant="outline" className="w-full group hover:border-primary hover:text-primary transition-all duration-200">
          <Link to="/tasks" className="flex items-center justify-center gap-2">
            View all tasks
            <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform duration-200" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
};

export default RecentTasks;

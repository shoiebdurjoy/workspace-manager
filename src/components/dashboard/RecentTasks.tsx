
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

interface RecentTasksProps {
  tasks: Task[];
  users: User[];
  maxItems?: number;
}

const getStatusBadgeVariant = (status: TaskStatus) => {
  switch (status) {
    case TaskStatus.COMPLETED:
      return 'bg-green-100 text-green-800 hover:bg-green-200';
    case TaskStatus.IN_PROGRESS:
      return 'bg-blue-100 text-blue-800 hover:bg-blue-200';
    case TaskStatus.TODO:
      return 'bg-gray-100 text-gray-800 hover:bg-gray-200';
    default:
      return '';
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
        <div className="space-y-2">
          {recentTasks.map(task => {
            const assignee = getUserByID(task.assignedTo);
            return (
              <div
                key={task.id}
                className="flex items-center justify-between p-3 rounded-md hover:bg-muted/50"
              >
                <div className="flex items-start gap-4">
                  <Badge
                    variant="outline"
                    className={`${getStatusBadgeVariant(task.status)} font-normal`}
                  >
                    {getStatusText(task.status)}
                  </Badge>
                  <div>
                    <p className="text-sm font-medium">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      Due {format(new Date(task.dueDate), 'MMM dd, yyyy')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {assignee && (
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={assignee.avatarUrl} />
                      <AvatarFallback>{assignee.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                  )}
                </div>
              </div>
            );
          })}

          {recentTasks.length === 0 && (
            <p className="text-center py-6 text-muted-foreground">No tasks found.</p>
          )}
        </div>
      </CardContent>
      <CardFooter>
        <Button asChild variant="outline" className="w-full">
          <Link to="/tasks">View all tasks</Link>
        </Button>
      </CardFooter>
    </Card>
  );
};

export default RecentTasks;

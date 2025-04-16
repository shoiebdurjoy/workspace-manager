
import React from 'react';
import { format } from 'date-fns';
import { 
  Calendar, 
  Link as LinkIcon, 
  ExternalLink, 
  AlertTriangle, 
  Flag, 
  Clock,
  X
} from 'lucide-react';
import { Task, TaskPriority, TaskLevel } from '@/types';
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getUserById } from '@/services/mockData';

interface TaskDetailProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TaskDetail: React.FC<TaskDetailProps> = ({ task, open, onOpenChange }) => {
  const assignee = task ? getUserById(task.assignedTo) : null;
  const isOverdue = task && new Date(task.dueDate) < new Date();

  const priorityBadge = {
    [TaskPriority.LOW]: <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-800">Low</Badge>,
    [TaskPriority.MEDIUM]: <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-800">Medium</Badge>,
    [TaskPriority.HIGH]: <Badge className="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200 hover:bg-red-200 dark:hover:bg-red-800">High</Badge>,
  };
  
  const levelBadge = {
    [TaskLevel.JUNIOR]: <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-200">Junior</Badge>,
    [TaskLevel.MID]: <Badge variant="outline" className="bg-purple-50 text-purple-700 dark:bg-purple-900 dark:text-purple-200">Mid</Badge>,
    [TaskLevel.SENIOR]: <Badge variant="outline" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">Senior</Badge>,
  };

  if (!task) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <ScrollArea className="h-full pr-4">
          <SheetHeader className="mb-6">
            <div className="flex justify-between items-start">
              <SheetTitle>{task.title}</SheetTitle>
              <SheetClose asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <X className="h-4 w-4" />
                </Button>
              </SheetClose>
            </div>
            <SheetDescription>Task ID: {task.id.substring(0, 8)}</SheetDescription>
          </SheetHeader>
          
          <div className="space-y-6">
            {/* Description */}
            <div>
              <h4 className="text-sm font-medium mb-2">Description</h4>
              <p className="text-sm text-muted-foreground">{task.description}</p>
            </div>
            
            <Separator />
            
            {/* Task Details */}
            <div className="space-y-4">
              {/* Status, Priority, Level */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <h4 className="text-xs text-muted-foreground mb-1">Status</h4>
                  <Badge variant="outline">{task.status.replace(/_/g, ' ')}</Badge>
                </div>
                <div>
                  <h4 className="text-xs text-muted-foreground mb-1">Priority</h4>
                  {task.priority && priorityBadge[task.priority]}
                </div>
                <div>
                  <h4 className="text-xs text-muted-foreground mb-1">Level</h4>
                  {task.level && levelBadge[task.level]}
                </div>
              </div>
              
              {/* Due Date */}
              <div>
                <h4 className="text-xs text-muted-foreground mb-1">Due Date</h4>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{format(new Date(task.dueDate), 'MMMM d, yyyy')}</span>
                  {isOverdue && (
                    <Badge variant="destructive" className="ml-2 text-xs">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Overdue
                    </Badge>
                  )}
                </div>
              </div>
              
              {/* External Link */}
              {task.externalLink && (
                <div>
                  <h4 className="text-xs text-muted-foreground mb-1">External Link</h4>
                  <div className="flex items-center gap-2">
                    <LinkIcon className="h-4 w-4 text-muted-foreground" />
                    <a 
                      href={task.externalLink}
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline flex items-center"
                    >
                      {task.externalLink.substring(0, 30)}{task.externalLink.length > 30 ? '...' : ''}
                      <ExternalLink className="h-3 w-3 ml-1" />
                    </a>
                  </div>
                </div>
              )}
            </div>
            
            <Separator />
            
            {/* Assignee */}
            <div>
              <h4 className="text-xs text-muted-foreground mb-2">Assignee</h4>
              {assignee ? (
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8">
                    {assignee.avatarUrl ? (
                      <AvatarImage src={assignee.avatarUrl} alt={assignee.name} />
                    ) : (
                      <AvatarFallback>
                        {assignee.name.split(' ').map(n => n[0]).join('')}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{assignee.name}</p>
                    <p className="text-xs text-muted-foreground">{assignee.email}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Unassigned</p>
              )}
            </div>
            
            {/* Payment Status */}
            <div>
              <h4 className="text-xs text-muted-foreground mb-1">Payment</h4>
              <div className="flex items-center gap-2">
                <Badge variant={task.payment.status === 'PAID' ? 'outline' : 'secondary'} className={task.payment.status === 'PAID' ? 'bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-200' : ''}>
                  ${task.payment.amount} - {task.payment.status}
                </Badge>
              </div>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};

export default TaskDetail;

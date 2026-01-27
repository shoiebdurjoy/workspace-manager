import React from 'react';
import { format } from 'date-fns';
import { 
  Calendar, 
  Link as LinkIcon, 
  ExternalLink, 
  AlertTriangle, 
  X,
  DollarSign
} from 'lucide-react';
import { Task, TaskPriority, TaskLevel, UserRole } from '@/types';
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
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

interface TaskDetailProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TaskDetail: React.FC<TaskDetailProps> = ({ task, open, onOpenChange }) => {
  const { currentUser } = useAuth();
  const assignee = task ? getUserById(task.assignedTo) : null;
  const isOverdue = task && new Date(task.dueDate) < new Date();
  
  // Check if current user should see payment info
  // Only the assigned person can see payment details
  const canSeePayment = currentUser && task && (
    currentUser.id === task.assignedTo || 
    currentUser.role === UserRole.AUTHOR
  );
  
  // For non-author users, only show if they are the assignee
  const showPaymentToUser = currentUser && task && currentUser.id === task.assignedTo;

  const priorityStyles = {
    [TaskPriority.LOW]: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800',
    [TaskPriority.MEDIUM]: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800',
    [TaskPriority.HIGH]: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
  };
  
  const levelStyles = {
    [TaskLevel.JUNIOR]: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400',
    [TaskLevel.MID]: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400',
    [TaskLevel.SENIOR]: 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400',
  };

  if (!task) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <ScrollArea className="h-full pr-4">
          <SheetHeader className="mb-6">
            <div className="flex justify-between items-start">
              <SheetTitle className="text-xl pr-8">{task.title}</SheetTitle>
              <SheetClose asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-primary/10">
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
              <p className="text-sm text-muted-foreground leading-relaxed">
                {task.description || 'No description provided'}
              </p>
            </div>
            
            <Separator />
            
            {/* Task Details */}
            <div className="space-y-4">
              {/* Status, Priority, Level */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <h4 className="text-xs text-muted-foreground mb-1.5">Status</h4>
                  <Badge variant="outline" className="text-xs">
                    {task.status.replace(/_/g, ' ')}
                  </Badge>
                </div>
                <div>
                  <h4 className="text-xs text-muted-foreground mb-1.5">Priority</h4>
                  <Badge variant="outline" className={cn("text-xs", priorityStyles[task.priority])}>
                    {task.priority}
                  </Badge>
                </div>
                <div>
                  <h4 className="text-xs text-muted-foreground mb-1.5">Level</h4>
                  <Badge variant="outline" className={cn("text-xs", levelStyles[task.level])}>
                    {task.level}
                  </Badge>
                </div>
              </div>
              
              {/* Due Date */}
              <div>
                <h4 className="text-xs text-muted-foreground mb-1.5">Due Date</h4>
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
                  <h4 className="text-xs text-muted-foreground mb-1.5">External Link</h4>
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
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50">
                  <Avatar className="h-10 w-10 ring-2 ring-background">
                    {assignee.avatarUrl ? (
                      <AvatarImage src={assignee.avatarUrl} alt={assignee.name} />
                    ) : (
                      <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-primary-foreground font-medium">
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
            
            {/* Payment Status - Only visible to assigned user */}
            {showPaymentToUser && task.payment.amount > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-xs text-muted-foreground mb-2">Your Payment</h4>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 border border-emerald-200/50 dark:border-emerald-800/50">
                    <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                      <DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                        ${task.payment.amount.toLocaleString()}
                      </p>
                      <Badge 
                        variant="outline" 
                        className={cn(
                          "text-xs",
                          task.payment.status === 'PAID' 
                            ? 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400' 
                            : 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400'
                        )}
                      >
                        {task.payment.status}
                      </Badge>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};

export default TaskDetail;

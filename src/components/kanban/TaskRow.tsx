import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { format } from 'date-fns';
import { AlertCircle, Calendar } from 'lucide-react';
import { Task, TaskPriority } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getUserById } from '@/services/mockData';
import { cn } from '@/lib/utils';

interface TaskRowProps {
  task: Task;
  onClick: () => void;
}

const TaskRow: React.FC<TaskRowProps> = ({ task, onClick }) => {
  const assignee = getUserById(task.assignedTo);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: task.id,
    data: {
      type: 'Task',
      task
    }
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 1,
  };

  const priorityStyles = {
    [TaskPriority.LOW]: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800',
    [TaskPriority.MEDIUM]: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800',
    [TaskPriority.HIGH]: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
  };

  const isOverdue = new Date(task.dueDate) < new Date();

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...attributes} 
      {...listeners}
      className="touch-none select-none"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <div className={cn(
        "rounded-xl mb-1.5 p-3 bg-card cursor-grab active:cursor-grabbing border transition-all duration-200",
        "hover:shadow-medium hover:border-primary/20 hover:-translate-y-0.5",
        isDragging ? "shadow-medium ring-2 ring-primary/20" : "shadow-soft"
      )}>
        <div className="flex justify-between items-start mb-2">
          <h4 className="font-medium text-sm line-clamp-2 leading-tight">{task.title}</h4>
          <Badge 
            variant="outline" 
            className={cn("text-[0.65rem] py-0 px-1.5 ml-2 shrink-0", priorityStyles[task.priority])}
          >
            {task.priority}
          </Badge>
        </div>
        
        <div className="flex justify-between items-center">
          <div className="flex items-center text-muted-foreground">
            <Calendar className="h-3 w-3 mr-1" />
            <span className="text-[0.7rem]">{format(new Date(task.dueDate), 'MMM d')}</span>
            
            {isOverdue && (
              <span className="ml-1.5 flex items-center text-destructive">
                <AlertCircle className="h-3 w-3" />
              </span>
            )}
          </div>
          
          {assignee && (
            <Avatar className="h-6 w-6 ring-2 ring-background">
              {assignee.avatarUrl ? (
                <AvatarImage src={assignee.avatarUrl} alt={assignee.name} />
              ) : (
                <AvatarFallback className="text-[0.6rem] bg-gradient-to-br from-primary to-accent text-primary-foreground font-medium">
                  {assignee.name.split(' ').map(n => n[0]).join('')}
                </AvatarFallback>
              )}
            </Avatar>
          )}
        </div>
      </div>
    </div>
  );
};

export default TaskRow;

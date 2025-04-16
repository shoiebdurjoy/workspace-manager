
import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { format } from 'date-fns';
import { AlertCircle, Calendar } from 'lucide-react';
import { Task, TaskPriority } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getUserById } from '@/services/mockData';

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

  const priorityColors = {
    [TaskPriority.LOW]: 'text-blue-600 bg-blue-50 dark:bg-blue-900 dark:text-blue-200',
    [TaskPriority.MEDIUM]: 'text-amber-600 bg-amber-50 dark:bg-amber-900 dark:text-amber-200',
    [TaskPriority.HIGH]: 'text-red-600 bg-red-50 dark:bg-red-900 dark:text-red-200',
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
      <div className="rounded mb-1 p-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-grab active:cursor-grabbing border border-slate-200 dark:border-slate-700 transition-colors duration-200 shadow-sm hover:shadow">
        <div className="flex justify-between items-center mb-1">
          <h4 className="font-medium text-xs line-clamp-1">{task.title}</h4>
          <Badge 
            variant="outline" 
            className={`text-[0.65rem] py-0 px-1.5 ${priorityColors[task.priority]}`}
          >
            {task.priority}
          </Badge>
        </div>
        
        <div className="flex justify-between items-center">
          <div className="flex items-center text-xs text-muted-foreground">
            <Calendar className="h-3 w-3 mr-1" />
            <span className="text-[0.65rem]">{format(new Date(task.dueDate), 'MMM d')}</span>
            
            {isOverdue && (
              <span className="ml-1 flex items-center text-red-500">
                <AlertCircle className="h-3 w-3 mr-0.5" />
              </span>
            )}
          </div>
          
          {assignee && (
            <Avatar className="h-5 w-5">
              {assignee.avatarUrl ? (
                <AvatarImage src={assignee.avatarUrl} alt={assignee.name} />
              ) : (
                <AvatarFallback className="text-[0.6rem]">
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

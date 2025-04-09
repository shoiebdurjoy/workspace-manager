
import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { format } from 'date-fns';
import { AlertCircle, Calendar, ExternalLink, Link as LinkIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Task, TaskPriority, TaskLevel } from '@/types';
import { getUserById } from '@/services/mockData';

interface TaskCardProps {
  task: Task;
}

const TaskCard: React.FC<TaskCardProps> = ({ task }) => {
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

  const priorityBadge = {
    [TaskPriority.LOW]: <Badge variant="outline" className="bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-200">Low</Badge>,
    [TaskPriority.MEDIUM]: <Badge variant="outline" className="bg-amber-50 text-amber-700 dark:bg-amber-900 dark:text-amber-200">Medium</Badge>,
    [TaskPriority.HIGH]: <Badge variant="outline" className="bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-200">High</Badge>,
  };

  const levelBadge = {
    [TaskLevel.JUNIOR]: <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-200">Junior</Badge>,
    [TaskLevel.MID]: <Badge variant="outline" className="bg-purple-50 text-purple-700 dark:bg-purple-900 dark:text-purple-200">Mid</Badge>,
    [TaskLevel.SENIOR]: <Badge variant="outline" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">Senior</Badge>,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="touch-none">
      <Card className="cursor-grab active:cursor-grabbing bg-card hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-md transition-all">
        <CardContent className="p-3 space-y-3">
          <div>
            <h4 className="font-medium text-sm">{task.title}</h4>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
          </div>
          
          <div className="flex flex-wrap gap-1">
            {priorityBadge[task.priority]}
            {levelBadge[task.level]}
          </div>
          
          {task.externalLink && (
            <div className="flex items-center text-xs text-muted-foreground">
              <LinkIcon className="h-3 w-3 mr-1" />
              <a 
                href={task.externalLink} 
                target="_blank" 
                rel="noopener noreferrer"
                className="truncate hover:text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {task.externalLink}
              </a>
            </div>
          )}
          
          <div className="flex justify-between items-center">
            <div className="flex items-center text-xs text-muted-foreground">
              <Calendar className="h-3 w-3 mr-1" />
              <span>{format(new Date(task.dueDate), 'MMM d, yyyy')}</span>
              
              {new Date(task.dueDate) < new Date() && (
                <span className="ml-1 flex items-center text-red-500">
                  <AlertCircle className="h-3 w-3 mr-0.5" />
                  Overdue
                </span>
              )}
            </div>
            
            {assignee && (
              <Avatar className="h-6 w-6">
                {assignee.avatarUrl ? (
                  <AvatarImage src={assignee.avatarUrl} alt={assignee.name} />
                ) : (
                  <AvatarFallback className="text-xs">
                    {assignee.name.split(' ').map(n => n[0]).join('')}
                  </AvatarFallback>
                )}
              </Avatar>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TaskCard;

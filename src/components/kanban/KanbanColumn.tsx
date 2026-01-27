import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Task, TaskStatus } from '@/types';
import TaskRow from './TaskRow';
import { cn } from '@/lib/utils';

interface KanbanColumnProps {
  id: string;
  title: string;
  tasks: Task[];
  status: TaskStatus;
  onTaskClick: (task: Task) => void;
}

const KanbanColumn: React.FC<KanbanColumnProps> = ({ id, title, tasks, status, onTaskClick }) => {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { status }
  });

  const columnColors = {
    [TaskStatus.NEW_REQUEST]: 'from-blue-500/10 to-blue-500/5 border-blue-200/50 dark:border-blue-800/50',
    [TaskStatus.ASSIGNED]: 'from-purple-500/10 to-purple-500/5 border-purple-200/50 dark:border-purple-800/50',
    [TaskStatus.IN_EDIT]: 'from-indigo-500/10 to-indigo-500/5 border-indigo-200/50 dark:border-indigo-800/50',
    [TaskStatus.REVISION_NEEDED]: 'from-amber-500/10 to-amber-500/5 border-amber-200/50 dark:border-amber-800/50',
    [TaskStatus.FIRST_APPROVAL]: 'from-teal-500/10 to-teal-500/5 border-teal-200/50 dark:border-teal-800/50',
    [TaskStatus.FINAL_APPROVAL]: 'from-emerald-500/10 to-emerald-500/5 border-emerald-200/50 dark:border-emerald-800/50',
    [TaskStatus.FOR_CLIENT_APPROVAL]: 'from-cyan-500/10 to-cyan-500/5 border-cyan-200/50 dark:border-cyan-800/50',
    [TaskStatus.COMPLETED]: 'from-green-500/10 to-green-500/5 border-green-200/50 dark:border-green-800/50',
    [TaskStatus.TODO]: 'from-slate-500/10 to-slate-500/5 border-slate-200/50 dark:border-slate-700/50',
    [TaskStatus.IN_PROGRESS]: 'from-blue-500/10 to-blue-500/5 border-blue-200/50 dark:border-blue-800/50',
  };

  return (
    <div 
      ref={setNodeRef}
      className={cn(
        "flex flex-col w-72 rounded-xl border bg-gradient-to-b shadow-soft transition-all duration-300",
        columnColors[status],
        isOver && "ring-2 ring-primary/30 scale-[1.02]"
      )}
    >
      <div className="p-3 border-b border-border/50 font-medium flex items-center justify-between sticky top-0 bg-inherit z-10 rounded-t-xl">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="bg-background/80 backdrop-blur-sm px-2.5 py-1 rounded-full text-xs font-semibold shadow-sm">
          {tasks.length}
        </div>
      </div>
      
      <ScrollArea className="h-[calc(100vh-240px)]">
        <div className="p-2">
          <SortableContext items={tasks.map(task => task.id)} strategy={verticalListSortingStrategy}>
            {tasks.map(task => (
              <TaskRow 
                key={task.id} 
                task={task} 
                onClick={() => onTaskClick(task)}
              />
            ))}
          </SortableContext>
          
          {tasks.length === 0 && (
            <div className="flex items-center justify-center h-20 border-2 border-dashed rounded-xl border-border/50 mx-1 my-2">
              <p className="text-xs text-muted-foreground">Drop tasks here</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default KanbanColumn;

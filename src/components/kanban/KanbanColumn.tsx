
import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Task, TaskStatus } from '@/types';
import TaskRow from './TaskRow';

interface KanbanColumnProps {
  id: string;
  title: string;
  tasks: Task[];
  status: TaskStatus;
  onTaskClick: (task: Task) => void;
}

const KanbanColumn: React.FC<KanbanColumnProps> = ({ id, title, tasks, status, onTaskClick }) => {
  const { setNodeRef } = useDroppable({
    id,
    data: { status }
  });

  const columnColors = {
    [TaskStatus.NEW_REQUEST]: 'bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-900',
    [TaskStatus.ASSIGNED]: 'bg-purple-50 border-purple-200 dark:bg-purple-950 dark:border-purple-900',
    [TaskStatus.IN_EDIT]: 'bg-indigo-50 border-indigo-200 dark:bg-indigo-950 dark:border-indigo-900',
    [TaskStatus.REVISION_NEEDED]: 'bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-900',
    [TaskStatus.FIRST_APPROVAL]: 'bg-teal-50 border-teal-200 dark:bg-teal-950 dark:border-teal-900',
    [TaskStatus.FINAL_APPROVAL]: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950 dark:border-emerald-900',
    [TaskStatus.FOR_CLIENT_APPROVAL]: 'bg-cyan-50 border-cyan-200 dark:bg-cyan-950 dark:border-cyan-900',
    [TaskStatus.COMPLETED]: 'bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-900',
    [TaskStatus.TODO]: 'bg-gray-50 border-gray-200 dark:bg-gray-900 dark:border-gray-800',
    [TaskStatus.IN_PROGRESS]: 'bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-900',
  };

  return (
    <div 
      ref={setNodeRef}
      className={`flex flex-col w-72 rounded-md border ${columnColors[status]} shadow-sm`}
    >
      <div className="p-2 border-b font-medium flex items-center justify-between sticky top-0 bg-inherit z-10">
        <h3 className="text-sm font-medium">{title}</h3>
        <div className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full text-xs font-medium">
          {tasks.length}
        </div>
      </div>
      
      <ScrollArea className="h-[calc(100vh-240px)]">
        <div className="p-1">
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
            <div className="flex items-center justify-center h-16 border border-dashed rounded-md border-slate-200 dark:border-slate-700 m-1">
              <p className="text-xs text-muted-foreground">No tasks</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default KanbanColumn;


import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  DndContext, 
  DragOverlay, 
  closestCorners, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragStartEvent,
  DragEndEvent
} from '@dnd-kit/core';
import { 
  SortableContext, 
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { ArrowLeft, Plus, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  Card,
  CardHeader,
  CardContent,
  CardDescription,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import KanbanColumn from '@/components/kanban/KanbanColumn';
import TaskCard from '@/components/kanban/TaskCard';
import { useAuth } from '@/context/AuthContext';
import { Task, TaskStatus, KanbanColumn as KanbanColumnType } from '@/types';
import { getWorkspaceById, getTasksForWorkspace, updateTaskStatus } from '@/services/mockData';

const WorkspaceDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  
  const [workspace, setWorkspace] = useState(id ? getWorkspaceById(id) : null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [columns, setColumns] = useState<KanbanColumnType[]>([]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (!workspace) {
      navigate('/workspaces');
      return;
    }

    const workspaceTasks = getTasksForWorkspace(workspace.id);
    setTasks(workspaceTasks);

    // Initialize columns based on TaskStatus enum
    const kanbanColumns: KanbanColumnType[] = [
      {
        id: 'new-request',
        title: 'New Request',
        status: TaskStatus.NEW_REQUEST,
        tasks: workspaceTasks.filter(task => task.status === TaskStatus.NEW_REQUEST),
      },
      {
        id: 'assigned',
        title: 'Assigned',
        status: TaskStatus.ASSIGNED,
        tasks: workspaceTasks.filter(task => task.status === TaskStatus.ASSIGNED),
      },
      {
        id: 'in-edit',
        title: 'In Edit',
        status: TaskStatus.IN_EDIT,
        tasks: workspaceTasks.filter(task => task.status === TaskStatus.IN_EDIT),
      },
      {
        id: 'revision-needed',
        title: 'Revision Needed',
        status: TaskStatus.REVISION_NEEDED,
        tasks: workspaceTasks.filter(task => task.status === TaskStatus.REVISION_NEEDED),
      },
      {
        id: 'first-approval',
        title: 'First Approval',
        status: TaskStatus.FIRST_APPROVAL,
        tasks: workspaceTasks.filter(task => task.status === TaskStatus.FIRST_APPROVAL),
      },
      {
        id: 'final-approval',
        title: 'Final Approval',
        status: TaskStatus.FINAL_APPROVAL,
        tasks: workspaceTasks.filter(task => task.status === TaskStatus.FINAL_APPROVAL),
      },
      {
        id: 'client-approval',
        title: 'For Client Approval',
        status: TaskStatus.FOR_CLIENT_APPROVAL,
        tasks: workspaceTasks.filter(task => task.status === TaskStatus.FOR_CLIENT_APPROVAL),
      },
      {
        id: 'completed',
        title: 'Completed',
        status: TaskStatus.COMPLETED,
        tasks: workspaceTasks.filter(task => task.status === TaskStatus.COMPLETED),
      },
    ];

    setColumns(kanbanColumns);
  }, [workspace, navigate]);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const taskId = active.id as string;
    
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      setActiveTask(task);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over) return;
    
    const taskId = active.id as string;
    const task = tasks.find(t => t.id === taskId);
    const destinationColumnId = over.id as string;
    
    // Find the destination column
    const destinationColumn = columns.find(col => col.id === destinationColumnId);
    
    if (task && destinationColumn && task.status !== destinationColumn.status) {
      // Update task status in mock API
      const updatedTask = updateTaskStatus(task.id, destinationColumn.status);
      
      // Update local state
      const updatedTasks = tasks.map(t => t.id === taskId ? updatedTask : t);
      setTasks(updatedTasks);
      
      // Update columns
      const updatedColumns = columns.map(column => {
        // Remove task from source column
        if (column.tasks.some(t => t.id === taskId)) {
          return {
            ...column,
            tasks: column.tasks.filter(t => t.id !== taskId)
          };
        }
        // Add task to destination column
        if (column.id === destinationColumnId) {
          return {
            ...column,
            tasks: [...column.tasks, updatedTask]
          };
        }
        return column;
      });
      
      setColumns(updatedColumns);
    }
    
    setActiveTask(null);
  };

  if (!workspace) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Workspace Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/workspaces')} className="mr-2">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{workspace.name}</h1>
            <p className="text-muted-foreground">{workspace.description}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => navigate(`/workspaces/${workspace.id}/tasks/new`)}>
            <Plus className="mr-2 h-4 w-4" />
            New Task
          </Button>
          <Button variant="outline" onClick={() => navigate(`/workspaces/${workspace.id}/settings`)}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </div>
      </div>
      
      {/* Workspace Tabs */}
      <Tabs defaultValue="kanban" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="kanban">Kanban Board</TabsTrigger>
          <TabsTrigger value="list">List View</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="members">Team Members</TabsTrigger>
        </TabsList>
        
        <TabsContent value="kanban" className="mt-6">
          <div className="overflow-x-auto pb-6">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="flex gap-4 min-w-max">
                {columns.map(column => (
                  <SortableContext
                    key={column.id}
                    items={column.tasks.map(task => task.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <KanbanColumn
                      id={column.id}
                      title={column.title}
                      tasks={column.tasks}
                      status={column.status}
                    />
                  </SortableContext>
                ))}
              </div>
              <DragOverlay>
                {activeTask ? (
                  <div className="transform-none">
                    <TaskCard task={activeTask} />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
        </TabsContent>
        
        <TabsContent value="list">
          <Card>
            <CardHeader>
              <CardTitle>Task List</CardTitle>
              <CardDescription>View all tasks in list format</CardDescription>
            </CardHeader>
            <CardContent>
              <p>List view coming soon...</p>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="calendar">
          <Card>
            <CardHeader>
              <CardTitle>Calendar View</CardTitle>
              <CardDescription>View tasks by due date</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Calendar view coming soon...</p>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="members">
          <Card>
            <CardHeader>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>Manage workspace members</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Team members management coming soon...</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default WorkspaceDetail;

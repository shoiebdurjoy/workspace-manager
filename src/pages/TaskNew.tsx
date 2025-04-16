import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, ArrowLeft, Link as LinkIcon } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { getUserById, getWorkspaceById, createTask, saveTasksToLocalStorage } from '@/services/mockData';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { TaskPriority, TaskLevel, User, PaymentStatus } from '@/types';

const TaskNew: React.FC = () => {
  const { id: workspaceId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [externalLink, setExternalLink] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [priority, setPriority] = useState<TaskPriority>(TaskPriority.MEDIUM);
  const [level, setLevel] = useState<TaskLevel>(TaskLevel.MID);
  const [payment, setPayment] = useState<number>(100);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [workspace, setWorkspace] = useState<any>(null);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);

  useEffect(() => {
    if (!workspaceId || !currentUser) {
      navigate('/workspaces');
      return;
    }

    const ws = getWorkspaceById(workspaceId);
    if (!ws) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Workspace not found.",
      });
      navigate('/workspaces');
      return;
    }
    
    setWorkspace(ws);
    
    // Get available users for assignment (workspace members)
    const users = ws.members
      .map(userId => getUserById(userId))
      .filter(user => user !== undefined) as User[];
      
    setAvailableUsers(users);
    
    // Set default assignee if there are available users
    if (users.length > 0 && users[0].id !== currentUser.id) {
      setAssignedTo(users[0].id);
    } else if (users.length > 1) {
      setAssignedTo(users[1].id);
    }
  }, [workspaceId, currentUser, navigate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentUser || !workspaceId || !dueDate) {
      toast({
        variant: "destructive",
        title: "Missing information",
        description: "Please fill in all required fields.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const newTask = createTask({
        title,
        description,
        externalLink: externalLink || undefined,
        assignedTo,
        workspaceId,
        createdBy: currentUser.id,
        dueDate,
        priority,
        level,
        payment: {
          amount: payment,
          status: PaymentStatus.PENDING,
        }
      });
      
      // Save tasks to localStorage for persistence
      saveTasksToLocalStorage();
      
      toast({
        title: "Task created!",
        description: `Task "${title}" has been created successfully.`,
      });
      
      navigate(`/workspaces/${workspaceId}`);
    } catch (error) {
      console.error('Error creating task:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to create task. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!workspace) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/workspaces/${workspaceId}`)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Create New Task</h1>
          <p className="text-muted-foreground">In workspace: {workspace.name}</p>
        </div>
      </div>

      <Card>
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle>Task Details</CardTitle>
            <CardDescription>
              Create a new task in the workspace. It will be added to the "New Request" column.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Task Title</Label>
              <Input
                id="title"
                placeholder="Enter task title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Enter task description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="externalLink">External Link (Optional)</Label>
              <div className="flex items-center">
                <LinkIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="externalLink"
                  type="url"
                  placeholder="https://example.com/reference"
                  value={externalLink}
                  onChange={(e) => setExternalLink(e.target.value)}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="assignedTo">Assign To</Label>
                <Select
                  value={assignedTo}
                  onValueChange={setAssignedTo}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select team member" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUsers.map(user => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name} {user.id === currentUser.id ? "(You)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !dueDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dueDate ? format(dueDate, "PPP") : <span>Select a date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dueDate}
                      onSelect={setDueDate}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <Select
                  value={priority}
                  onValueChange={(value) => setPriority(value as TaskPriority)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TaskPriority.LOW}>Low</SelectItem>
                    <SelectItem value={TaskPriority.MEDIUM}>Medium</SelectItem>
                    <SelectItem value={TaskPriority.HIGH}>High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="level">Experience Level</Label>
                <Select
                  value={level}
                  onValueChange={(value) => setLevel(value as TaskLevel)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TaskLevel.JUNIOR}>Junior</SelectItem>
                    <SelectItem value={TaskLevel.MID}>Mid</SelectItem>
                    <SelectItem value={TaskLevel.SENIOR}>Senior</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="payment">Payment Amount ($)</Label>
                <Input
                  id="payment"
                  type="number"
                  min="0"
                  step="10"
                  value={payment}
                  onChange={(e) => setPayment(Number(e.target.value))}
                  required
                />
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => navigate(`/workspaces/${workspaceId}`)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !dueDate || !assignedTo}>
              {isSubmitting ? 'Creating...' : 'Create Task'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default TaskNew;

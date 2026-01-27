import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, ArrowLeft, Link as LinkIcon, Shield } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
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
import { TaskPriority, TaskLevel, User, PaymentStatus, UserRole } from '@/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

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
  const [payment, setPayment] = useState<number | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [workspace, setWorkspace] = useState<any>(null);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);

  const isAuthor = currentUser?.role === UserRole.AUTHOR;

  useEffect(() => {
    if (!workspaceId || !currentUser) {
      navigate('/workspaces');
      return;
    }

    // Only authors can create tasks
    if (!isAuthor) {
      toast({
        variant: "destructive",
        title: "Access Denied",
        description: "Only authors can create new tasks.",
      });
      navigate(`/workspaces/${workspaceId}`);
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
    
    // Get all workspace members for assignment
    const users = ws.members
      .map(userId => getUserById(userId))
      .filter(user => user !== undefined) as User[];
      
    setAvailableUsers(users);
    
    // Set default assignee if there are available users (prefer non-author)
    const nonAuthors = users.filter(u => u.role !== UserRole.AUTHOR);
    if (nonAuthors.length > 0) {
      setAssignedTo(nonAuthors[0].id);
    } else if (users.length > 0) {
      setAssignedTo(users[0].id);
    }
  }, [workspaceId, currentUser, navigate, isAuthor]);

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
          amount: payment || 0,
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
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Show access denied for non-authors
  if (!isAuthor) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <Shield className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <p className="text-muted-foreground">Only authors can create new tasks.</p>
        <Button onClick={() => navigate(`/workspaces/${workspaceId}`)}>
          Back to Workspace
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in">
      <div className="flex items-center gap-3">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => navigate(`/workspaces/${workspaceId}`)}
          className="rounded-full hover:bg-primary/10"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Create New Task</h1>
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
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="title">Task Title *</Label>
              <Input
                id="title"
                placeholder="Enter task title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Enter task description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="resize-none"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="externalLink">External Link (Optional)</Label>
              <div className="relative">
                <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="externalLink"
                  type="url"
                  placeholder="https://example.com/reference"
                  value={externalLink}
                  onChange={(e) => setExternalLink(e.target.value)}
                  className="pl-10 h-11"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label htmlFor="assignedTo">Assign To *</Label>
                <Select
                  value={assignedTo}
                  onValueChange={setAssignedTo}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select team member" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUsers.map(user => (
                      <SelectItem key={user.id} value={user.id}>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={user.avatarUrl} />
                            <AvatarFallback className="text-xs bg-gradient-to-br from-primary to-accent text-primary-foreground">
                              {user.name.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <span>{user.name}</span>
                          {user.id === currentUser?.id && (
                            <span className="text-xs text-muted-foreground">(You)</span>
                          )}
                          {user.role === UserRole.AUTHOR && (
                            <span className="text-xs text-primary">(Author)</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Due Date *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full h-11 justify-start text-left font-normal",
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
                  <SelectTrigger className="h-11">
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
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TaskLevel.JUNIOR}>Junior</SelectItem>
                    <SelectItem value={TaskLevel.MID}>Mid</SelectItem>
                    <SelectItem value={TaskLevel.SENIOR}>Senior</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="payment">Payment Amount ($ - Optional)</Label>
                <Input
                  id="payment"
                  type="number"
                  min="0"
                  step="10"
                  value={payment ?? ''}
                  onChange={(e) => setPayment(e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="Enter payment amount (optional)"
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">
                  Payment details will only be visible to the assigned team member.
                </p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between gap-3">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => navigate(`/workspaces/${workspaceId}`)}
              className="flex-1 md:flex-none"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isSubmitting || !dueDate || !assignedTo || !title}
              className="flex-1 md:flex-none gradient-primary hover:opacity-90"
            >
              {isSubmitting ? 'Creating...' : 'Create Task'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default TaskNew;

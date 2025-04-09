
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { 
  CheckCircle2, 
  CircleDashed, 
  Clock, 
  DollarSign, 
  Filter, 
  Plus, 
  Search 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Task, TaskStatus, PaymentStatus } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { getTasksForUser, getUserById } from '@/services/mockData';

const TaskStatusIcon: React.FC<{ status: TaskStatus }> = ({ status }) => {
  switch (status) {
    case TaskStatus.COMPLETED:
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case TaskStatus.IN_PROGRESS:
      return <Clock className="h-4 w-4 text-blue-500" />;
    case TaskStatus.TODO:
      return <CircleDashed className="h-4 w-4 text-gray-500" />;
    default:
      return null;
  }
};

const PaymentStatusBadge: React.FC<{ status: PaymentStatus }> = ({ status }) => {
  switch (status) {
    case PaymentStatus.PAID:
      return (
        <Badge variant="outline" className="bg-green-100 text-green-800 hover:bg-green-200">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Paid
        </Badge>
      );
    case PaymentStatus.PENDING:
      return (
        <Badge variant="outline" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200">
          <DollarSign className="mr-1 h-3 w-3" />
          Pending
        </Badge>
      );
    default:
      return null;
  }
};

const Tasks: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatus[]>([]);

  if (!currentUser) {
    return <div className="flex items-center justify-center h-full">Loading...</div>;
  }

  // Get all tasks for the current user
  const allTasks = getTasksForUser(currentUser.id);

  // Apply filters
  const filteredTasks = allTasks.filter(task => {
    // Apply search filter
    const matchesSearch = 
      searchQuery === '' || 
      task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.description.toLowerCase().includes(searchQuery.toLowerCase());

    // Apply status filter
    const matchesStatus = 
      statusFilter.length === 0 || 
      statusFilter.includes(task.status);
    
    // Apply payment filter
    const matchesPayment = 
      paymentFilter.length === 0 || 
      paymentFilter.includes(task.payment.status);
    
    return matchesSearch && matchesStatus && matchesPayment;
  });

  // Handler for task status checkbox changes
  const handleStatusFilterChange = (status: TaskStatus) => {
    setStatusFilter(prev => {
      if (prev.includes(status)) {
        return prev.filter(s => s !== status);
      } else {
        return [...prev, status];
      }
    });
  };

  // Handler for payment status checkbox changes
  const handlePaymentFilterChange = (status: PaymentStatus) => {
    setPaymentFilter(prev => {
      if (prev.includes(status)) {
        return prev.filter(s => s !== status);
      } else {
        return [...prev, status];
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Tasks</h1>
          <p className="text-muted-foreground">
            Manage and track all your tasks
          </p>
        </div>
        <Button onClick={() => navigate('/tasks/new')}>
          <Plus className="mr-2 h-4 w-4" />
          New Task
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Filter className="mr-2 h-4 w-4" />
              Filter
              {(statusFilter.length > 0 || paymentFilter.length > 0) && (
                <Badge className="ml-2 bg-primary" variant="secondary">
                  {statusFilter.length + paymentFilter.length}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuLabel>Task Status</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuCheckboxItem
                checked={statusFilter.includes(TaskStatus.TODO)}
                onCheckedChange={() => handleStatusFilterChange(TaskStatus.TODO)}
              >
                To Do
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={statusFilter.includes(TaskStatus.IN_PROGRESS)}
                onCheckedChange={() => handleStatusFilterChange(TaskStatus.IN_PROGRESS)}
              >
                In Progress
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={statusFilter.includes(TaskStatus.COMPLETED)}
                onCheckedChange={() => handleStatusFilterChange(TaskStatus.COMPLETED)}
              >
                Completed
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuLabel>Payment Status</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuCheckboxItem
                checked={paymentFilter.includes(PaymentStatus.PENDING)}
                onCheckedChange={() => handlePaymentFilterChange(PaymentStatus.PENDING)}
              >
                Pending
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={paymentFilter.includes(PaymentStatus.PAID)}
                onCheckedChange={() => handlePaymentFilterChange(PaymentStatus.PAID)}
              >
                Paid
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10">
                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                    <CheckSquare className="h-12 w-12 mb-2 text-muted-foreground/50" />
                    <p>No tasks found</p>
                    <p className="text-sm">Try adjusting your filters or create a new task</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredTasks.map((task) => {
                const assignee = getUserById(task.assignedTo);
                return (
                  <TableRow 
                    key={task.id} 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/tasks/${task.id}`)}
                  >
                    <TableCell>
                      <TaskStatusIcon status={task.status} />
                    </TableCell>
                    <TableCell className="font-medium">
                      {task.title}
                      <div className="text-xs text-muted-foreground mt-1 max-w-[300px] truncate">
                        {task.description}
                      </div>
                    </TableCell>
                    <TableCell>
                      {format(new Date(task.dueDate), 'MMM dd, yyyy')}
                    </TableCell>
                    <TableCell>{assignee?.name || 'Unassigned'}</TableCell>
                    <TableCell>
                      <PaymentStatusBadge status={task.payment.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      ${task.payment.amount}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default Tasks;

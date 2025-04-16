
import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { UserRole, PaymentStatus, TaskStatus } from '@/types';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Check, X, ChevronDown, ChevronUp, DollarSign, Clock, BarChart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getTasksForUser,
  getUserById,
  updateTaskPaymentStatus,
  getMonthlyStats,
  saveTasksToLocalStorage,
  mockUsers,
  getTasksForWorkspace,
  getWorkspaceById
} from '@/services/mockData';
import { toast } from '@/components/ui/use-toast';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { 
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent 
} from '@/components/ui/collapsible';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const Payments: React.FC = () => {
  const { currentUser } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [monthlyStats, setMonthlyStats] = useState([]);
  const [openEmployees, setOpenEmployees] = useState({});
  
  useEffect(() => {
    if (currentUser) {
      // Load tasks for the current user
      const userTasks = getTasksForUser(currentUser.id);
      setTasks(userTasks);
      
      // If current user is an Author, load all employees
      if (currentUser.role === UserRole.AUTHOR) {
        const employeeList = mockUsers.filter(user => user.role === UserRole.EMPLOYEE);
        
        // Initialize openEmployees state
        const initialOpenState = {};
        employeeList.forEach(emp => {
          initialOpenState[emp.id] = true; // Start with all sections open
        });
        setOpenEmployees(initialOpenState);
        
        // Load all employees with their tasks
        const employeesWithTasks = employeeList.map(employee => {
          const employeeTasks = getTasksForUser(employee.id);
          const completedTasks = employeeTasks.filter(task => 
            task.status === TaskStatus.COMPLETED
          );
          
          const unpaidTasks = completedTasks.filter(
            task => task.payment.status === PaymentStatus.PENDING
          );
          
          return {
            ...employee,
            tasks: completedTasks,
            unpaidTasks: unpaidTasks,
            totalCompleted: completedTasks.length,
            totalUnpaid: unpaidTasks.length,
            totalPaid: completedTasks.length - unpaidTasks.length
          };
        });
        
        setEmployees(employeesWithTasks);
      }
      
      // Load monthly stats for Employee view
      if (currentUser.role === UserRole.EMPLOYEE) {
        const stats = getMonthlyStats(currentUser.id);
        setMonthlyStats(stats);
      }
    }
  }, [currentUser]);

  const toggleEmployeeCollapse = (employeeId) => {
    setOpenEmployees(prev => ({
      ...prev,
      [employeeId]: !prev[employeeId]
    }));
  };

  const handlePaymentStatusToggle = (taskId, currentStatus) => {
    if (currentUser?.role !== UserRole.AUTHOR) return;
    
    try {
      const newStatus = currentStatus === PaymentStatus.PAID ? PaymentStatus.PENDING : PaymentStatus.PAID;
      updateTaskPaymentStatus(taskId, newStatus);
      
      // Update tasks state
      const updatedTasks = tasks.map(task => 
        task.id === taskId 
          ? { 
              ...task, 
              payment: { 
                ...task.payment, 
                status: newStatus, 
                paidAt: newStatus === PaymentStatus.PAID ? new Date() : undefined 
              } 
            } 
          : task
      );
      
      setTasks(updatedTasks);
      
      // Update employees state as well
      setEmployees(prevEmployees => 
        prevEmployees.map(employee => {
          const updatedEmployeeTasks = employee.tasks.map(task => 
            task.id === taskId
              ? { 
                  ...task, 
                  payment: { 
                    ...task.payment, 
                    status: newStatus, 
                    paidAt: newStatus === PaymentStatus.PAID ? new Date() : undefined 
                  } 
                } 
              : task
          );
          
          const updatedUnpaidTasks = updatedEmployeeTasks.filter(
            task => task.payment.status === PaymentStatus.PENDING
          );
          
          return {
            ...employee,
            tasks: updatedEmployeeTasks,
            unpaidTasks: updatedUnpaidTasks,
            totalUnpaid: updatedUnpaidTasks.length,
            totalPaid: updatedEmployeeTasks.length - updatedUnpaidTasks.length
          };
        })
      );
      
      // Save changes to localStorage
      saveTasksToLocalStorage();
      
      toast({
        title: "Payment status updated",
        description: `Task payment marked as ${newStatus === PaymentStatus.PAID ? 'paid' : 'pending'}`,
      });
    } catch (error) {
      console.error('Error updating payment status:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update payment status. Please try again.",
      });
    }
  };

  // Calculate total amounts
  const totalAmount = tasks.reduce((sum, task) => sum + task.payment.amount, 0);
  const paidAmount = tasks.filter(task => task.payment.status === PaymentStatus.PAID)
    .reduce((sum, task) => sum + task.payment.amount, 0);
  const pendingAmount = totalAmount - paidAmount;

  // Author view shows employees with their tasks
  const renderAuthorView = () => {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Payments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${totalAmount}</div>
            </CardContent>
          </Card>
          
          <Card className="shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Paid</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">${paidAmount}</div>
            </CardContent>
          </Card>
          
          <Card className="shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Pending</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">${pendingAmount}</div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <h2 className="text-2xl font-bold">Employee Payments</h2>
          {employees.length > 0 ? (
            employees.map(employee => (
              <Card key={employee.id} className="overflow-hidden shadow-md">
                <Collapsible open={openEmployees[employee.id]} onOpenChange={() => toggleEmployeeCollapse(employee.id)}>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="bg-slate-50 dark:bg-slate-800 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <Avatar className="h-10 w-10">
                            {employee.avatarUrl ? (
                              <AvatarImage src={employee.avatarUrl} alt={employee.name} />
                            ) : (
                              <AvatarFallback>
                                {employee.name.split(' ').map(n => n[0]).join('')}
                              </AvatarFallback>
                            )}
                          </Avatar>
                          <div>
                            <h3 className="font-semibold">{employee.name}</h3>
                            <div className="flex space-x-4 text-sm text-muted-foreground mt-1">
                              <div className="flex items-center">
                                <Check className="mr-1 h-4 w-4 text-green-600" />
                                <span>{employee.totalCompleted} tasks completed</span>
                              </div>
                              <div className="flex items-center">
                                <Clock className="mr-1 h-4 w-4 text-amber-600" />
                                <span>{employee.totalUnpaid} unpaid</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center">
                          <div className="mr-4">
                            <div className="text-right font-medium">${employee.tasks.reduce((sum, task) => sum + task.payment.amount, 0)}</div>
                            <div className="text-xs text-muted-foreground">Total earnings</div>
                          </div>
                          {openEmployees[employee.id] ? (
                            <ChevronUp className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Task</TableHead>
                            <TableHead>Workspace</TableHead>
                            <TableHead>Completed on</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {employee.tasks.length > 0 ? (
                            employee.tasks.map(task => {
                              const workspace = getWorkspaceById(task.workspaceId);
                              return (
                                <TableRow key={task.id}>
                                  <TableCell className="font-medium">{task.title}</TableCell>
                                  <TableCell>{workspace?.name || 'Unknown'}</TableCell>
                                  <TableCell>
                                    {task.completedAt ? new Date(task.completedAt).toLocaleDateString() : '-'}
                                  </TableCell>
                                  <TableCell>${task.payment.amount}</TableCell>
                                  <TableCell>
                                    {task.payment.status === PaymentStatus.PAID ? (
                                      <Badge variant="success" className="flex items-center">
                                        <Check className="mr-1 h-3 w-3" /> Paid
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="flex items-center text-amber-600">
                                        <X className="mr-1 h-3 w-3" /> Unpaid
                                      </Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button 
                                      variant={task.payment.status === PaymentStatus.PAID ? "outline" : "default"}
                                      size="sm"
                                      onClick={() => handlePaymentStatusToggle(task.id, task.payment.status)}
                                    >
                                      {task.payment.status === PaymentStatus.PAID ? 'Mark Unpaid' : (
                                        <>
                                          <Check className="mr-1 h-3 w-3" />
                                          Mark Paid
                                        </>
                                      )}
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          ) : (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center py-8">
                                No completed tasks found
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            ))
          ) : (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">No employees found</p>
            </Card>
          )}
        </div>
      </div>
    );
  };

  // Employee view shows their own payment history
  const renderEmployeeView = () => {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Earnings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${totalAmount}</div>
            </CardContent>
          </Card>
          
          <Card className="shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Paid</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">${paidAmount}</div>
            </CardContent>
          </Card>
          
          <Card className="shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Pending</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">${pendingAmount}</div>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-md">
          <CardHeader>
            <CardTitle>Monthly Performance</CardTitle>
            <CardDescription>Tasks completed and earnings by month</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsBarChart data={monthlyStats}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="completed" name="Tasks Completed" fill="#3b82f6" />
                  <Bar yAxisId="right" dataKey="earnings" name="Earnings ($)" fill="#10b981" />
                </RechartsBarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle>Payment History</CardTitle>
            <CardDescription>View your task payment history</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Completed on</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Paid on</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.filter(task => task.status === TaskStatus.COMPLETED).map(task => {
                  const workspace = getWorkspaceById(task.workspaceId);
                  return (
                    <TableRow key={task.id}>
                      <TableCell className="font-medium">{task.title}</TableCell>
                      <TableCell>{workspace?.name || 'Unknown'}</TableCell>
                      <TableCell>
                        {task.completedAt ? new Date(task.completedAt).toLocaleDateString() : '-'}
                      </TableCell>
                      <TableCell>${task.payment.amount}</TableCell>
                      <TableCell>
                        {task.payment.status === PaymentStatus.PAID ? (
                          <Badge variant="success" className="flex items-center">
                            <Check className="mr-1 h-3 w-3" /> Paid
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="flex items-center text-amber-600">
                            <X className="mr-1 h-3 w-3" /> Unpaid
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {task.payment.paidAt ? new Date(task.payment.paidAt).toLocaleDateString() : '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
                
                {tasks.filter(task => task.status === TaskStatus.COMPLETED).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      No completed tasks found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Payments</h1>
        <p className="text-muted-foreground">Track and manage task payments</p>
      </div>

      {currentUser?.role === UserRole.AUTHOR ? renderAuthorView() : renderEmployeeView()}
    </div>
  );
};

export default Payments;


import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { UserRole, PaymentStatus } from '@/types';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getTasksForUser,
  getUserById,
  updateTaskPaymentStatus,
  getMonthlyStats,
  saveTasksToLocalStorage
} from '@/services/mockData';
import { toast } from '@/components/ui/use-toast';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const Payments: React.FC = () => {
  const { currentUser } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [monthlyStats, setMonthlyStats] = useState([]);
  
  useEffect(() => {
    if (currentUser) {
      const userTasks = getTasksForUser(currentUser.id);
      setTasks(userTasks);
      
      if (currentUser.role === UserRole.EMPLOYEE) {
        const stats = getMonthlyStats(currentUser.id);
        setMonthlyStats(stats);
      }
    }
  }, [currentUser]);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Payments</h1>
        <p className="text-muted-foreground">Track and manage task payments</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Earnings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalAmount}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Paid</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">${paidAmount}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">${pendingAmount}</div>
          </CardContent>
        </Card>
      </div>

      {currentUser?.role === UserRole.EMPLOYEE && (
        <Card>
          <CardHeader>
            <CardTitle>Monthly Performance</CardTitle>
            <CardDescription>Tasks completed and earnings by month</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyStats}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="completed" name="Tasks Completed" fill="#3b82f6" />
                  <Bar yAxisId="right" dataKey="earnings" name="Earnings ($)" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
      
      <Card>
        <CardHeader>
          <CardTitle>Payment History</CardTitle>
          <CardDescription>
            {currentUser?.role === UserRole.AUTHOR 
              ? "Manage payments for all tasks" 
              : "View your task payment history"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                {currentUser?.role === UserRole.AUTHOR && <TableHead>Assignee</TableHead>}
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date Paid</TableHead>
                {currentUser?.role === UserRole.AUTHOR && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map(task => {
                const assignee = getUserById(task.assignedTo);
                return (
                  <TableRow key={task.id}>
                    <TableCell className="font-medium">{task.title}</TableCell>
                    {currentUser?.role === UserRole.AUTHOR && (
                      <TableCell>{assignee?.name || 'Unassigned'}</TableCell>
                    )}
                    <TableCell>${task.payment.amount}</TableCell>
                    <TableCell>
                      <Badge variant={task.payment.status === PaymentStatus.PAID ? "success" : "outline"}>
                        {task.payment.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {task.payment.paidAt ? new Date(task.payment.paidAt).toLocaleDateString() : '-'}
                    </TableCell>
                    {currentUser?.role === UserRole.AUTHOR && (
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
                    )}
                  </TableRow>
                );
              })}
              
              {tasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={currentUser?.role === UserRole.AUTHOR ? 6 : 4} className="text-center py-8">
                    No payment records found
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

export default Payments;

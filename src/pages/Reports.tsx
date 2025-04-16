
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useAuth } from '@/context/AuthContext';
import { mockTasks } from '@/services/mockData';
import { TaskStatus } from '@/types';

const taskStatusData = [
  { status: 'New Request', count: mockTasks.filter(t => t.status === TaskStatus.NEW_REQUEST).length, color: '#94a3b8' },
  { status: 'Assigned', count: mockTasks.filter(t => t.status === TaskStatus.ASSIGNED).length, color: '#3b82f6' },
  { status: 'In Edit', count: mockTasks.filter(t => t.status === TaskStatus.IN_EDIT).length, color: '#6366f1' },
  { status: 'Revision', count: mockTasks.filter(t => t.status === TaskStatus.REVISION_NEEDED).length, color: '#f97316' },
  { status: 'First Approval', count: mockTasks.filter(t => t.status === TaskStatus.FIRST_APPROVAL).length, color: '#10b981' },
  { status: 'Final Approval', count: mockTasks.filter(t => t.status === TaskStatus.FINAL_APPROVAL).length, color: '#14b8a6' },
  { status: 'Client Approval', count: mockTasks.filter(t => t.status === TaskStatus.FOR_CLIENT_APPROVAL).length, color: '#f59e0b' },
  { status: 'Completed', count: mockTasks.filter(t => t.status === TaskStatus.COMPLETED).length, color: '#22c55e' },
];

// Sample team performance data
const teamPerformanceData = [
  { name: 'Team A', completed: 32, inProgress: 21 },
  { name: 'Team B', completed: 28, inProgress: 17 },
  { name: 'Team C', completed: 19, inProgress: 12 },
  { name: 'Team D', completed: 24, inProgress: 15 },
];

// Monthly productivity data (tasks completed per month)
const monthlyData = [
  { month: 'Jan', tasks: 12 },
  { month: 'Feb', tasks: 19 },
  { month: 'Mar', tasks: 25 },
  { month: 'Apr', tasks: 18 },
  { month: 'May', tasks: 22 },
  { month: 'Jun', tasks: 30 },
];

const Reports: React.FC = () => {
  const { currentUser } = useAuth();
  
  if (!currentUser) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Reports</h1>
          <p className="text-muted-foreground">Performance analytics and statistics</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Task Status Distribution</CardTitle>
            <CardDescription>Breakdown of tasks by current status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={taskStatusData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="count"
                    nameKey="status"
                  >
                    {taskStatusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Team Performance</CardTitle>
            <CardDescription>Completed vs. in-progress tasks by team</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={teamPerformanceData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="completed" name="Completed Tasks" fill="#22c55e" />
                  <Bar dataKey="inProgress" name="In Progress" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Monthly Productivity</CardTitle>
          <CardDescription>Task completion rate over time</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="tasks" name="Tasks Completed" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Reports;

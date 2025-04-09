
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const taskStatusData = [
  { status: 'New Request', count: 12, color: '#94a3b8' },
  { status: 'Assigned', count: 8, color: '#3b82f6' },
  { status: 'In Edit', count: 15, color: '#6366f1' },
  { status: 'Revision', count: 5, color: '#f97316' },
  { status: 'First Approval', count: 7, color: '#10b981' },
  { status: 'Final Approval', count: 4, color: '#14b8a6' },
  { status: 'Client Approval', count: 3, color: '#f59e0b' },
  { status: 'Completed', count: 18, color: '#22c55e' },
];

const teamPerformanceData = [
  { name: 'Team A', completed: 32, inProgress: 21 },
  { name: 'Team B', completed: 28, inProgress: 17 },
  { name: 'Team C', completed: 19, inProgress: 12 },
  { name: 'Team D', completed: 24, inProgress: 15 },
];

const Reports: React.FC = () => {
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
            <p className="text-center text-muted-foreground py-10">Additional reports and charts coming soon...</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Reports;

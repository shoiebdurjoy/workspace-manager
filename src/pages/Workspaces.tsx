
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { getWorkspacesForUser } from '@/services/mockData';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';

const Workspaces: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const workspaces = currentUser ? getWorkspacesForUser(currentUser.id) : [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Workspaces</h1>
          <p className="text-muted-foreground">
            Manage your teams and projects
          </p>
        </div>
        <Button onClick={() => navigate('/workspaces/new')}>
          <PlusCircle className="mr-2 h-4 w-4" />
          New Workspace
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {workspaces.map(workspace => (
          <Card 
            key={workspace.id} 
            className="cursor-pointer hover:shadow-md transition-all"
            onClick={() => navigate(`/workspaces/${workspace.id}`)}
          >
            <CardHeader>
              <CardTitle>{workspace.name}</CardTitle>
              <CardDescription>{workspace.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {workspace.members.length} members
              </p>
            </CardContent>
          </Card>
        ))}
        
        {workspaces.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground mb-4">No workspaces found</p>
            <Button onClick={() => navigate('/workspaces/new')}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Create Your First Workspace
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Workspaces;

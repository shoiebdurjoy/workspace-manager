
import React from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, ChevronRight, Users } from 'lucide-react';
import { Workspace } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface WorkspacesListProps {
  workspaces: Workspace[];
  maxItems?: number;
}

const WorkspacesList: React.FC<WorkspacesListProps> = ({ workspaces, maxItems = 3 }) => {
  const displayWorkspaces = workspaces.slice(0, maxItems);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Workspaces</CardTitle>
        <CardDescription>Workspaces you are a member of</CardDescription>
      </CardHeader>
      <CardContent className="px-2">
        <div className="space-y-2">
          {displayWorkspaces.map(workspace => (
            <Link
              key={workspace.id}
              to={`/workspaces/${workspace.id}`}
              className="flex items-center justify-between p-3 rounded-md hover:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 p-2 rounded-md">
                  <Briefcase className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{workspace.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <Users className="h-3 w-3 inline mr-1" />
                    {workspace.members.length} members
                  </p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </Link>
          ))}

          {displayWorkspaces.length === 0 && (
            <p className="text-center py-6 text-muted-foreground">No workspaces found.</p>
          )}
        </div>
      </CardContent>
      <CardFooter>
        <div className="flex w-full gap-2">
          <Button asChild variant="outline" className="w-full">
            <Link to="/workspaces">View all workspaces</Link>
          </Button>
          <Button asChild className="w-full">
            <Link to="/workspaces/new">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mr-2"
              >
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
              New Workspace
            </Link>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
};

export default WorkspacesList;

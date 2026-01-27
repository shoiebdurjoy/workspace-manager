import React from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, ChevronRight, Users, Plus, ArrowRight } from 'lucide-react';
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
import { cn } from '@/lib/utils';

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
        <div className="space-y-1">
          {displayWorkspaces.map((workspace, index) => (
            <Link
              key={workspace.id}
              to={`/workspaces/${workspace.id}`}
              className={cn(
                "flex items-center justify-between p-3 rounded-xl transition-all duration-200 hover:bg-muted/50 group",
                "animate-in"
              )}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-center gap-3">
                <div className="bg-gradient-to-br from-primary/10 to-accent/10 p-2.5 rounded-xl group-hover:from-primary/20 group-hover:to-accent/20 transition-all duration-300">
                  <Briefcase className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium group-hover:text-primary transition-colors duration-200">
                    {workspace.name}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {workspace.members.length} members
                  </p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all duration-200" />
            </Link>
          ))}

          {displayWorkspaces.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">No workspaces found.</p>
          )}
        </div>
      </CardContent>
      <CardFooter>
        <div className="flex w-full gap-2">
          <Button asChild variant="outline" className="w-full group hover:border-primary hover:text-primary transition-all duration-200">
            <Link to="/workspaces" className="flex items-center justify-center gap-2">
              View all
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform duration-200" />
            </Link>
          </Button>
          <Button asChild className="w-full group gradient-primary hover:opacity-90 transition-opacity duration-200 border-0">
            <Link to="/workspaces/new" className="flex items-center justify-center gap-2">
              <Plus className="h-4 w-4" />
              New Workspace
            </Link>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
};

export default WorkspacesList;

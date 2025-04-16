
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { createWorkspace } from '@/services/mockData';

const WorkspaceNew: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentUser) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "You must be logged in to create a workspace.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const newWorkspace = createWorkspace({
        name,
        description,
        createdBy: currentUser.id,
        members: [currentUser.id],
      });
      
      toast({
        title: "Workspace created!",
        description: `Workspace "${name}" has been created successfully.`,
      });
      
      navigate(`/workspaces/${newWorkspace.id}`);
    } catch (error) {
      console.error('Error creating workspace:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to create workspace. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Create New Workspace</h1>
          <p className="text-muted-foreground">Set up a new team or project workspace</p>
        </div>
      </div>

      <Card>
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle>Workspace Details</CardTitle>
            <CardDescription>
              Create a workspace to organize your projects and collaborate with team members.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Workspace Name</Label>
              <Input
                id="name"
                placeholder="Enter workspace name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Enter workspace description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => navigate('/workspaces')}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Workspace'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default WorkspaceNew;

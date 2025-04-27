
import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ShieldX } from 'lucide-react';

const Unauthorized: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/20 px-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <ShieldX className="h-8 w-8 text-red-500" />
        </div>
        <h1 className="text-5xl font-bold text-gray-900 mb-4">401</h1>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
        <p className="text-muted-foreground mb-8">
          You don't have permission to access this page. Please contact your administrator
          if you believe this is a mistake.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button asChild>
            <Link to="/dashboard">Back to Dashboard</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/">Go to Home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Unauthorized;

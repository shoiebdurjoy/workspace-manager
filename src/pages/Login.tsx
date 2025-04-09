
import React, { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, isAuthenticated } = useAuth();

  // Redirect if already authenticated
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    await login(email, password);
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-workwise-600 text-white rounded-full flex items-center justify-center mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-check-circle-2"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Sign in to WorkWise</h2>
          <p className="text-gray-600 mt-2">Enter your details to access your account</p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              required
              autoComplete="email"
            />
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link to="/forgot-password" className="text-sm text-workwise-600 hover:text-workwise-800">
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>
          
          <Button 
            type="submit" 
            className="w-full bg-workwise-600 hover:bg-workwise-700" 
            disabled={isLoading}
          >
            {isLoading ? 'Signing in...' : 'Sign in'}
          </Button>
          
          <div className="text-center text-gray-500 text-sm mt-4">
            Don't have an account?{' '}
            <Link to="/register" className="text-workwise-600 hover:text-workwise-800 font-medium">
              Create an account
            </Link>
          </div>
        </form>

        <div className="mt-8">
          <p className="text-sm text-center text-gray-500 mb-2">Demo accounts:</p>
          <div className="grid grid-cols-2 gap-3">
            <Button 
              variant="outline" 
              className="text-xs" 
              onClick={() => {
                setEmail('admin@workwise.com');
                setPassword('admin123');
              }}
            >
              Admin
            </Button>
            <Button 
              variant="outline" 
              className="text-xs" 
              onClick={() => {
                setEmail('employee@workwise.com');
                setPassword('employee123');
              }}
            >
              Employee
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;

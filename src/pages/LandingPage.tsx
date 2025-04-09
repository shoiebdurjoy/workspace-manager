
import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';

const LandingPage: React.FC = () => {
  const { isAuthenticated } = useAuth();

  return (
    <div className="bg-gradient-to-b from-white to-gray-50 min-h-screen">
      {/* Header/Nav */}
      <header className="border-b border-gray-100">
        <div className="container mx-auto flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-2">
            <div className="bg-workwise-600 text-white p-1 rounded">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-check-circle-2"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
            </div>
            <span className="text-lg font-bold">WorkWise</span>
          </div>
          
          <div>
            {isAuthenticated ? (
              <Button asChild>
                <Link to="/dashboard">Go to Dashboard</Link>
              </Button>
            ) : (
              <div className="flex gap-4">
                <Button variant="outline" asChild>
                  <Link to="/login">Login</Link>
                </Button>
                <Button asChild>
                  <Link to="/register">Register</Link>
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto py-20 px-4">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6">
              Task Management Made <span className="text-workwise-600">Simple</span>
            </h1>
            <p className="text-xl text-gray-600 mb-8">
              WorkWise helps teams track tasks, monitor productivity, and manage payments in one unified platform.
            </p>
            <div className="flex gap-4">
              <Button size="lg" asChild>
                <Link to="/register">Get Started</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/login">Log In</Link>
              </Button>
            </div>
          </div>
          <div className="hidden md:block">
            <img
              src="https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&auto=format&fit=crop&q=80"
              alt="Task Management"
              className="rounded-lg shadow-lg"
            />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-white py-20 px-4">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Key Features</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Everything you need to manage your team and track progress efficiently.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-6 border rounded-lg">
              <div className="w-12 h-12 bg-workwise-100 rounded-lg flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-workwise-600"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
              </div>
              <h3 className="text-xl font-bold mb-2">Task Management</h3>
              <p className="text-gray-600">
                Create, assign and track tasks with ease. Monitor progress and keep everyone on the same page.
              </p>
            </div>

            <div className="p-6 border rounded-lg">
              <div className="w-12 h-12 bg-workwise-100 rounded-lg flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-workwise-600"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <h3 className="text-xl font-bold mb-2">Team Workspaces</h3>
              <p className="text-gray-600">
                Organize teams into workspaces to streamline collaboration and improve communication.
              </p>
            </div>

            <div className="p-6 border rounded-lg">
              <div className="w-12 h-12 bg-workwise-100 rounded-lg flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-workwise-600"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              </div>
              <h3 className="text-xl font-bold mb-2">Payment Tracking</h3>
              <p className="text-gray-600">
                Track payments for completed tasks and keep financial records organized.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-workwise-600 text-white py-16 px-4">
        <div className="container mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
          <p className="text-xl opacity-90 max-w-2xl mx-auto mb-8">
            Join thousands of teams already using WorkWise to improve productivity and task management.
          </p>
          <Button size="lg" variant="outline" className="bg-white hover:bg-gray-100 text-workwise-600" asChild>
            <Link to="/register">Sign Up for Free</Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-50 border-t py-12 px-4">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center gap-2 mb-6 md:mb-0">
              <div className="bg-workwise-600 text-white p-1 rounded">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
              </div>
              <span className="font-bold">WorkWise</span>
            </div>
            <div className="text-sm text-gray-500">
              &copy; 2025 WorkWise. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;

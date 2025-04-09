
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  BarChart3,
  Briefcase,
  CheckSquare,
  CreditCard,
  Home,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';

interface SidebarNavProps {
  isCollapsed: boolean;
}

const SidebarNav: React.FC<SidebarNavProps> = ({ isCollapsed }) => {
  const { pathname } = useLocation();
  const { currentUser } = useAuth();
  const isAuthor = currentUser?.role === 'AUTHOR';

  const routes = [
    {
      icon: Home,
      label: 'Dashboard',
      href: '/dashboard',
      active: pathname === '/dashboard',
    },
    {
      icon: Briefcase,
      label: 'Workspaces',
      href: '/workspaces',
      active: pathname.startsWith('/workspaces'),
    },
    {
      icon: CheckSquare,
      label: 'Tasks',
      href: '/tasks',
      active: pathname.startsWith('/tasks'),
    },
    ...(isAuthor ? [
      {
        icon: Users,
        label: 'Employees',
        href: '/employees',
        active: pathname.startsWith('/employees'),
      },
    ] : []),
    {
      icon: CreditCard,
      label: 'Payments',
      href: '/payments',
      active: pathname.startsWith('/payments'),
    },
    {
      icon: BarChart3,
      label: 'Reports',
      href: '/reports',
      active: pathname.startsWith('/reports'),
    },
  ];

  return (
    <div className={cn(
      "flex",
      isCollapsed ? "flex-col items-center space-y-4" : "flex-col space-y-1"
    )}>
      {routes.map((route) => (
        <Button
          key={route.label}
          variant={route.active ? "secondary" : "ghost"}
          className={cn(
            "justify-start",
            isCollapsed ? "w-10 px-0 justify-center" : "w-full"
          )}
          asChild
        >
          <Link to={route.href}>
            <route.icon className={cn(
              "h-5 w-5",
              isCollapsed ? "mr-0" : "mr-2"
            )} />
            {!isCollapsed && <span>{route.label}</span>}
          </Link>
        </Button>
      ))}
    </div>
  );
};

interface SidebarProps {
  className?: string;
}

const Sidebar: React.FC<SidebarProps> = ({ className }) => {
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  return (
    <div className={cn(
      "flex flex-col border-r bg-background",
      isCollapsed ? "w-16" : "w-64",
      "transition-width duration-300",
      className
    )}>
      <div className="flex h-16 items-center justify-between px-4 border-b">
        {!isCollapsed && (
          <Link to="/" className="flex items-center gap-2">
            <div className="bg-workwise-600 text-white p-1 rounded">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-check-circle-2"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
            </div>
            <span className="text-lg font-bold">WorkWise</span>
          </Link>
        )}
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn("ml-auto", isCollapsed && "mx-auto")}
        >
          {isCollapsed ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-chevron-right"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-chevron-left"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          )}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <SidebarNav isCollapsed={isCollapsed} />
      </div>
    </div>
  );
};

export default Sidebar;

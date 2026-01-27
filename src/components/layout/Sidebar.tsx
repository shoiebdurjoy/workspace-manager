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
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import Logo from '@/components/brand/Logo';

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
    <TooltipProvider delayDuration={0}>
      <div className={cn(
        "flex flex-col gap-1",
        isCollapsed ? "items-center" : ""
      )}>
        {routes.map((route) => {
          const NavButton = (
            <Button
              key={route.label}
              variant="ghost"
              className={cn(
                "justify-start h-11 transition-all duration-200",
                isCollapsed ? "w-11 px-0 justify-center" : "w-full px-3",
                route.active 
                  ? "bg-primary/10 text-primary hover:bg-primary/15 shadow-soft" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
              asChild
            >
              <Link to={route.href}>
                <route.icon className={cn(
                  "h-5 w-5 transition-transform duration-200",
                  route.active && "scale-110",
                  isCollapsed ? "mr-0" : "mr-3"
                )} />
                {!isCollapsed && (
                  <span className="font-medium">{route.label}</span>
                )}
              </Link>
            </Button>
          );

          if (isCollapsed) {
            return (
              <Tooltip key={route.label}>
                <TooltipTrigger asChild>
                  {NavButton}
                </TooltipTrigger>
                <TooltipContent side="right" className="font-medium">
                  {route.label}
                </TooltipContent>
              </Tooltip>
            );
          }

          return NavButton;
        })}
      </div>
    </TooltipProvider>
  );
};

interface SidebarProps {
  className?: string;
}

const Sidebar: React.FC<SidebarProps> = ({ className }) => {
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  return (
    <div className={cn(
      "flex flex-col border-r bg-sidebar transition-all duration-300 ease-in-out relative",
      isCollapsed ? "w-[68px]" : "w-64",
      className
    )}>
      <div className="flex h-16 items-center justify-between px-4 border-b">
        {!isCollapsed && (
          <Link to="/">
            <Logo size="sm" />
          </Link>
        )}
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn(
            "h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary transition-all duration-200",
            isCollapsed && "mx-auto"
          )}
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <SidebarNav isCollapsed={isCollapsed} />
      </div>
      
      {/* Decorative gradient at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-sidebar to-transparent pointer-events-none" />
    </div>
  );
};

export default Sidebar;

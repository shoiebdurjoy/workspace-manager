import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Menu,
  Search,
  Plus,
  Bell,
  WifiOff,
  User,
  Settings,
  LogOut,
  Palette,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

export interface AppHeaderProps {
  onToggleMobileSidebar: () => void;
  onOpenSearch: () => void;
  onQuickTask: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  onToggleMobileSidebar,
  onOpenSearch,
  onQuickTask,
}) => {
  const { currentUser, logout, isOfflineMode } = useAuth();
  const location = useLocation();
  const [unreadNotifications, setUnreadNotifications] = useState(2);

  // Generate dynamic breadcrumbs based on pathname
  const getBreadcrumbs = () => {
    const path = location.pathname;
    if (path === "/dashboard" || path === "/") {
      return [{ label: "TBB Workspace", href: "/dashboard" }, { label: "Home" }];
    }
    if (path.startsWith("/tasks")) {
      return [{ label: "TBB Workspace", href: "/dashboard" }, { label: "Everything", href: "/tasks" }];
    }
    if (path.startsWith("/workspaces")) {
      return [{ label: "TBB Workspace", href: "/dashboard" }, { label: "Spaces & Folders", href: "/workspaces" }];
    }
    if (path.startsWith("/reports")) {
      return [{ label: "TBB Workspace", href: "/dashboard" }, { label: "Reports & Analytics", href: "/reports" }];
    }
    if (path.startsWith("/payments")) {
      return [{ label: "TBB Workspace", href: "/dashboard" }, { label: "Payments & Payouts", href: "/payments" }];
    }
    if (path.startsWith("/settings")) {
      return [{ label: "TBB Workspace", href: "/dashboard" }, { label: "Settings", href: "/settings" }];
    }
    if (path.startsWith("/profile")) {
      return [{ label: "TBB Workspace", href: "/dashboard" }, { label: "User Profile", href: "/profile" }];
    }
    if (path.startsWith("/design-system")) {
      return [{ label: "TBB Workspace", href: "/dashboard" }, { label: "Design System Showcase", href: "/design-system" }];
    }
    return [{ label: "TBB Workspace", href: "/dashboard" }, { label: "Overview" }];
  };

  const breadcrumbs = getBreadcrumbs();

  return (
    <header className="sticky top-0 z-30 flex h-13 w-full items-center justify-between border-b border-border/70 bg-background/95 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/80 select-none">
      {/* Left section: Mobile Hamburger + Breadcrumb hierarchy */}
      <div className="flex items-center gap-3 min-w-0">
        <IconButton
          aria-label="Toggle navigation menu"
          icon={<Menu className="h-4 w-4" />}
          variant="ghost"
          size="sm"
          onClick={onToggleMobileSidebar}
          className="lg:hidden"
        />

        <Breadcrumb className="hidden sm:flex text-xs">
          <BreadcrumbList>
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <React.Fragment key={idx}>
                  {idx > 0 && <BreadcrumbSeparator className="[&>svg]:size-3" />}
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage className="font-semibold text-foreground truncate max-w-[180px]">
                        {crumb.label}
                      </BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink
                        asChild
                        className="text-muted-foreground hover:text-foreground font-medium truncate max-w-[140px]"
                      >
                        <Link to={crumb.href || "#"}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </React.Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Center/Search trigger */}
      <div className="flex-1 max-w-md mx-4 hidden md:block">
        <button
          type="button"
          onClick={onOpenSearch}
          className="w-full flex items-center justify-between h-8 px-3 rounded-lg border border-border/80 bg-muted/40 hover:bg-muted/70 text-xs text-muted-foreground hover:text-foreground transition-all group"
        >
          <div className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground group-hover:text-purple-600 transition-colors" />
            <span className="truncate">Search tasks, spaces, commands...</span>
          </div>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 pointer-events-none select-none rounded border border-border/70 bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground shadow-xs">
            <span className="text-xs">⌘</span>K
          </kbd>
        </button>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-2">
        {/* Mobile Search Icon Button */}
        <IconButton
          aria-label="Search workspace"
          tooltip="Search (⌘K)"
          icon={<Search className="h-4 w-4" />}
          variant="ghost"
          size="sm"
          onClick={onOpenSearch}
          className="md:hidden"
        />

        {/* Offline Mode Badge */}
        {isOfflineMode && (
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
            <WifiOff className="h-3 w-3" />
            <span>Local Mode</span>
          </span>
        )}

        {/* ClickUp Style Quick "+ Task" Button */}
        <Button
          size="sm"
          onClick={onQuickTask}
          className="bg-gradient-to-r from-[#7B2CBF] to-[#7B68EE] text-white hover:opacity-95 shadow-xs text-xs font-semibold h-8 px-3 gap-1.5 rounded-lg active:scale-95 transition-all"
        >
          <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
          <span className="hidden sm:inline">New Task</span>
        </Button>

        {/* Notifications Popover */}
        <Popover>
          <PopoverTrigger asChild>
            <div className="relative">
              <IconButton
                aria-label="Notifications"
                tooltip="Notifications"
                icon={<Bell className="h-4 w-4" />}
                variant="ghost"
                size="sm"
              />
              {unreadNotifications > 0 && (
                <span className="absolute 1 top-1 right-1 h-2 w-2 rounded-full bg-purple-600 ring-2 ring-background animate-pulse" />
              )}
            </div>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0 text-xs">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="font-semibold text-foreground">Notifications</span>
              {unreadNotifications > 0 && (
                <button
                  onClick={() => setUnreadNotifications(0)}
                  className="text-[11px] text-purple-600 hover:underline flex items-center gap-1"
                >
                  <Check className="h-3 w-3" />
                  Mark all as read
                </button>
              )}
            </div>
            <div className="divide-y divide-border/60 max-h-64 overflow-y-auto">
              <div className="p-3 hover:bg-muted/40 transition-colors">
                <p className="font-medium text-foreground">QC Approval Required</p>
                <p className="text-muted-foreground text-[11px] mt-0.5">
                  Video task &quot;25. EDAPTX - Final Master&quot; submitted to QC.
                </p>
                <span className="text-[10px] text-muted-foreground/80 mt-1 block">10 minutes ago</span>
              </div>
              <div className="p-3 hover:bg-muted/40 transition-colors">
                <p className="font-medium text-foreground">New Assignment</p>
                <p className="text-muted-foreground text-[11px] mt-0.5">
                  You were assigned to &quot;Shorts Episode #42&quot;.
                </p>
                <span className="text-[10px] text-muted-foreground/80 mt-1 block">1 hour ago</span>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Theme Toggle */}
        <ThemeToggle />

        {/* User Profile Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="User account menu"
              className="rounded-full ring-2 ring-transparent hover:ring-purple-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 transition-all p-0.5"
            >
              <UserAvatar
                name={currentUser?.name || "TBB User"}
                src={currentUser?.avatarUrl}
                size="sm"
                status="online"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-60" align="end" sideOffset={8}>
            <DropdownMenuLabel className="font-normal p-3">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-semibold text-foreground leading-none">
                  {currentUser?.name || "TBB User"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {currentUser?.email || "user@thinkbigbrand.com"}
                </p>
                <div className="pt-1.5 flex items-center gap-1.5">
                  <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-950/60 px-2 py-0.5 rounded-md">
                    {currentUser?.role === "AUTHOR" ? "👑 Admin (Author)" : "👤 Team Member"}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            <DropdownMenuItem asChild className="cursor-pointer text-xs">
              <Link to="/profile" className="flex items-center">
                <User className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                <span>Profile Settings</span>
              </Link>
            </DropdownMenuItem>

            <DropdownMenuItem asChild className="cursor-pointer text-xs">
              <Link to="/settings" className="flex items-center">
                <Settings className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                <span>Workspace Settings</span>
              </Link>
            </DropdownMenuItem>

            <DropdownMenuItem asChild className="cursor-pointer text-xs">
              <Link to="/design-system" className="flex items-center">
                <Palette className="mr-2 h-3.5 w-3.5 text-pink-500" />
                <span>Design System Showcase</span>
              </Link>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={logout}
              className="cursor-pointer text-destructive text-xs focus:text-destructive focus:bg-destructive/10"
            >
              <LogOut className="mr-2 h-3.5 w-3.5" />
              <span>Log Out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

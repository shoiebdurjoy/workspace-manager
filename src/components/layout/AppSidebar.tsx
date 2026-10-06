import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  CheckSquare,
  Inbox,
  UserCheck,
  Search,
  ChevronRight,
  ChevronLeft,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Logo from "@/components/brand/Logo";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useAuth } from "@/hooks/use-auth";
import { can, ROLE_LABELS } from "@/lib/permissions";
import SpacesTree from "@/components/hierarchy/SpacesTree";

export interface AppSidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onOpenSearch: () => void;
  className?: string;
  onCloseMobile?: () => void;
}

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  /** Roadmap phase that delivers this area; rendered disabled until then. */
  comingInPhase?: number;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  isCollapsed,
  onToggleCollapse,
  onOpenSearch,
  className,
  onCloseMobile,
}) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { profile, role, workspace } = useAuth();

  const handleNavClick = (href: string) => {
    navigate(href);
    onCloseMobile?.();
  };

  const primaryNavItems: NavItem[] = [
    { label: "Home", icon: Home, href: "/home" },
    { label: "Inbox", icon: Inbox, comingInPhase: 11 },
    { label: "My Tasks", icon: UserCheck, comingInPhase: 11 },
    { label: "Everything", icon: CheckSquare, comingInPhase: 8 },
  ];

  const managementNavItems: NavItem[] = [
    ...(can(role, "team:view") ? [{ label: "Team", icon: Users, href: "/team" }] : []),
    { label: "Settings", icon: Settings, href: "/settings" },
  ];

  const renderItem = (item: NavItem) => {
    const active = !!item.href && (pathname === item.href || pathname.startsWith(`${item.href}/`));
    const disabled = !item.href;
    const btn = (
      <button
        key={item.label}
        type="button"
        disabled={disabled}
        aria-current={active ? "page" : undefined}
        onClick={() => item.href && handleNavClick(item.href)}
        className={cn(
          "flex items-center rounded-lg text-xs font-medium transition-all group w-full",
          isCollapsed ? "h-9 w-9 justify-center mx-auto" : "h-8 px-2.5 justify-between",
          active
            ? "nav-active"
            : disabled
              ? "text-muted-foreground/60 cursor-default"
              : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
        )}
      >
        <span className="flex items-center gap-2.5">
          <item.icon
            className={cn(
              "h-4 w-4 shrink-0 transition-colors",
              active ? "text-brand" : "text-muted-foreground group-hover:text-foreground"
            )}
          />
          {!isCollapsed && <span className="truncate">{item.label}</span>}
        </span>
        {!isCollapsed && item.comingInPhase && (
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">Soon</span>
        )}
      </button>
    );

    if (isCollapsed || item.comingInPhase) {
      return (
        <Tooltip key={item.label}>
          <TooltipTrigger asChild>
            <span className="block">{btn}</span>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-semibold text-xs">
            {item.label}
            {item.comingInPhase ? ` · arrives in Phase ${item.comingInPhase}` : ""}
          </TooltipContent>
        </Tooltip>
      );
    }
    return btn;
  };

  return (
    <TooltipProvider delayDuration={150}>
      <aside
        className={cn(
          "flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out select-none relative z-20 shrink-0",
          isCollapsed ? "w-16" : "w-64",
          className
        )}
        aria-label="Main navigation"
      >
        {/* Brand */}
        <div className="flex h-13 items-center justify-between px-3 border-b border-sidebar-border">
          {!isCollapsed ? (
            <Link
              to="/home"
              aria-label="TBB Workspace home"
              className="flex min-w-0 items-center overflow-hidden rounded-md hover:opacity-90"
              onClick={onCloseMobile}
            >
              <Logo size="sm" />
            </Link>
          ) : (
            <div className="mx-auto">
              <Link to="/home" onClick={onCloseMobile} aria-label="Home">
                <Logo size="sm" showText={false} />
              </Link>
            </div>
          )}
          <IconButton
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            tooltip={isCollapsed ? "Expand sidebar" : undefined}
            tooltipSide="right"
            icon={isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            variant="ghost"
            size="xs"
            onClick={onToggleCollapse}
            className="text-muted-foreground hover:text-foreground"
          />
        </div>

        {!isCollapsed && workspace && (
          <div className="px-3 pt-3">
            <p className="truncate px-1 text-xs font-semibold text-foreground" title={workspace.name}>
              {workspace.name}
            </p>
          </div>
        )}

        {!isCollapsed && (
          <div className="px-3 pt-2">
            <button
              type="button"
              onClick={onOpenSearch}
              className="w-full flex items-center justify-between h-8 px-2.5 rounded-lg border border-border bg-background hover:bg-sidebar-accent text-xs text-muted-foreground hover:text-foreground transition-colors group"
            >
              <span className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                <span>Search</span>
              </span>
              <kbd className="inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1 text-[10px] font-mono text-muted-foreground">
                ⌘K
              </kbd>
            </button>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          <div className="space-y-0.5">{primaryNavItems.map(renderItem)}</div>

          {can(role, "hierarchy:view") && (
            <div className="pt-2 border-t border-border/50">
              <SpacesTree collapsed={isCollapsed} onNavigate={onCloseMobile} />
            </div>
          )}

          <div className="pt-2 border-t border-border/50 space-y-0.5">
            {!isCollapsed && (
              <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Management</p>
            )}
            {managementNavItems.map(renderItem)}
          </div>
        </nav>

        {!isCollapsed && profile && (
          <Link
            to="/profile"
            onClick={onCloseMobile}
            className="flex items-center gap-2 border-t border-sidebar-border p-2.5 hover:bg-sidebar-accent"
          >
            <UserAvatar name={profile.fullName} src={profile.avatarUrl ?? undefined} size="xs" />
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-foreground">{profile.fullName}</span>
              <span className="block truncate text-[10px] text-muted-foreground">{role ? ROLE_LABELS[role] : ""}</span>
            </span>
          </Link>
        )}
      </aside>
    </TooltipProvider>
  );
};

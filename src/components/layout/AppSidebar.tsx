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
  Layers,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Logo from "@/components/brand/Logo";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useAuth } from "@/hooks/use-auth";
import { can, ROLE_LABELS } from "@/lib/permissions";

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
            ? "bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 font-semibold"
            : disabled
              ? "text-muted-foreground/50 cursor-default"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
        )}
      >
        <span className="flex items-center gap-2.5">
          <item.icon
            className={cn(
              "h-4 w-4 shrink-0 transition-colors",
              active ? "text-purple-600 dark:text-purple-400" : "text-muted-foreground group-hover:text-foreground"
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
          "flex flex-col border-r border-border/70 bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out select-none relative z-20 shrink-0",
          isCollapsed ? "w-16" : "w-64",
          className
        )}
        aria-label="Main navigation"
      >
        {/* Brand */}
        <div className="flex h-13 items-center justify-between px-3 border-b border-border/60">
          {!isCollapsed ? (
            <Link to="/home" className="flex items-center gap-2 overflow-hidden hover:opacity-90" onClick={onCloseMobile}>
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
            <p className="truncate px-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {workspace.name}
            </p>
          </div>
        )}

        {!isCollapsed && (
          <div className="px-3 pt-2">
            <button
              type="button"
              onClick={onOpenSearch}
              className="w-full flex items-center justify-between h-8 px-2.5 rounded-lg border border-border/70 bg-muted/40 hover:bg-muted/70 text-xs text-muted-foreground hover:text-foreground transition-colors group"
            >
              <span className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground group-hover:text-purple-600 transition-colors" />
                <span>Search</span>
              </span>
              <kbd className="inline-flex items-center gap-0.5 rounded border border-border/60 bg-background px-1 text-[10px] font-mono text-muted-foreground">
                ⌘K
              </kbd>
            </button>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          <div className="space-y-0.5">{primaryNavItems.map(renderItem)}</div>

          {/* Spaces: real hierarchy arrives in Phase 5. Nothing is simulated here. */}
          <div className="pt-2 border-t border-border/50">
            {!isCollapsed ? (
              <div className="space-y-1">
                <p className="flex items-center gap-1.5 px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Layers className="h-3 w-3" />
                  Spaces
                </p>
                <p className="px-2 py-1 text-[11px] leading-relaxed text-muted-foreground/80">
                  No spaces yet. Spaces, folders and client lists arrive in Phase 5.
                </p>
              </div>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="mx-auto flex h-9 w-9 items-center justify-center text-muted-foreground/50">
                    <Layers className="h-4 w-4" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  Spaces arrive in Phase 5
                </TooltipContent>
              </Tooltip>
            )}
          </div>

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
            className="flex items-center gap-2 border-t border-border/60 bg-muted/20 p-2.5 hover:bg-muted/40"
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

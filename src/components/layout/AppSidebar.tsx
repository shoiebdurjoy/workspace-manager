import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  CheckSquare,
  Inbox,
  UserCheck,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  BarChart3,
  Settings,
  Users,
  CalendarDays,
  Gauge,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand/Logo";
import { IconButton } from "@/components/ui/icon-button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useAuth } from "@/hooks/use-auth";
import { useInboxCount } from "@/hooks/use-inbox";
import { can, ROLE_LABELS } from "@/lib/permissions";
import SpacesTree from "@/components/hierarchy/SpacesTree";

export interface AppSidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onOpenSearch: () => void;
  className?: string;
  onCloseMobile?: () => void;
  /** width of the contextual panel in px (desktop); dragging its right edge calls onResize */
  panelWidth?: number;
  onResize?: (width: number) => void;
}

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 520;
export const SIDEBAR_DEFAULT_WIDTH = 264;

interface NavItem {
  label: string;
  icon: LucideIcon;
  href?: string;
  /** Roadmap phase that delivers this area; rendered disabled until then. */
  comingInPhase?: number;
  /** A real count from the database (the Inbox's unread), never a placeholder. */
  badge?: number;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  isCollapsed,
  onToggleCollapse,
  onOpenSearch,
  className,
  onCloseMobile,
  panelWidth,
  onResize,
}) => {
  const [dragging, setDragging] = React.useState(false);
  const clamp = (w: number) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(w)));

  /** Drag the panel's right edge, like ClickUp: the width follows the pointer and is remembered. */
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onResize || panelWidth === undefined) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (ev: PointerEvent) => onResize(clamp(startW + ev.clientX - startX));
    const up = () => {
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { profile, role, workspace } = useAuth();
  const inboxCount = useInboxCount().data ?? 0;

  const handleNavClick = (href: string) => {
    navigate(href);
    onCloseMobile?.();
  };

  const primaryNavItems: NavItem[] = [
    { label: "Home", icon: Home, href: "/home" },
    ...(can(role, "comments:view-internal") ? [{ label: "Inbox", icon: Inbox, href: "/inbox", badge: inboxCount }] : []),
    ...(can(role, "hierarchy:view") ? [{ label: "My Tasks", icon: UserCheck, href: "/my-tasks" }] : []),
    ...(can(role, "hierarchy:view") ? [{ label: "Calendar", icon: CalendarDays, href: "/calendar" }] : []),
    ...(can(role, "hierarchy:view") ? [{ label: "Everything", icon: CheckSquare, href: "/everything" }] : []),
  ];

  const managementNavItems: NavItem[] = [
    ...(can(role, "team:view") ? [{ label: "Team", icon: Users, href: "/team" }] : []),
    ...(can(role, "production:view") ? [{ label: "Workload", icon: Gauge, href: "/workload" }] : []),
    ...(can(role, "production:view") ? [{ label: "Reports", icon: TrendingUp, href: "/reports" }] : []),
    ...(can(role, "production:view") ? [{ label: "Production", icon: BarChart3, href: "/production" }] : []),
    { label: "Settings", icon: Settings, href: "/settings" },
  ];

  const renderRailItem = (item: NavItem) => {
    const active = !!item.href && (pathname === item.href || pathname.startsWith(`${item.href}/`));
    return (
      <button
        key={item.label}
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={() => item.href && handleNavClick(item.href)}
        className={cn(
          "press group relative flex w-[52px] flex-col items-center gap-0.5 rounded-control px-0 py-1.5 text-[9.5px] tracking-tight font-medium leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "bg-brand-subtle text-brand-subtle-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        )}
      >
        <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.25 : 1.75} />
        <span className="whitespace-nowrap">{item.label}</span>
        {!!item.badge && (
          <span
            aria-label={`${item.badge} unread`}
            className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[9px] font-semibold leading-4 tabular-nums text-primary-foreground"
          >
            {item.badge > 99 ? "99+" : item.badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <TooltipProvider delayDuration={150}>
      <aside
        className={cn(
          "theme-nav nav-surface relative z-20 flex shrink-0 select-none border-r text-sidebar-foreground",
          className
        )}
        aria-label="Main navigation"
      >
        {/* Icon rail */}
        <div className="flex w-[60px] shrink-0 flex-col items-center gap-1 border-r border-[hsl(var(--surface-glass-border))] py-2.5">
          <Link
            to="/home"
            aria-label="TBB Workspace home"
            onClick={onCloseMobile}
            className="press mb-1.5 rounded-control p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BrandMark size="sm" />
          </Link>
          <nav aria-label="Primary" className="flex flex-col items-center gap-1">
            {primaryNavItems.map(renderRailItem)}
          </nav>
          <div className="flex-1" />
          {isCollapsed && (
            <IconButton
              aria-label="Expand sidebar"
              tooltip="Expand sidebar"
              tooltipSide="right"
              icon={<PanelLeftOpen className="h-4 w-4" />}
              variant="ghost"
              size="xs"
              onClick={onToggleCollapse}
              className="mb-1 text-muted-foreground hover:text-foreground"
            />
          )}
          <div className="flex flex-col items-center gap-1">{managementNavItems.map(renderRailItem)}</div>
          {profile && (
            <Link
              to="/profile"
              aria-label="Your profile"
              onClick={onCloseMobile}
              className="press mt-1.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <UserAvatar name={profile.fullName} src={profile.avatarUrl ?? undefined} size="sm" />
            </Link>
          )}
        </div>

        {/* Contextual panel */}
        {!isCollapsed && (
          <div
            className={cn("relative flex min-w-0 flex-1 flex-col md:flex-none", panelWidth === undefined && "md:w-[16.5rem]")}
            style={panelWidth !== undefined ? { width: panelWidth } : undefined}
          >
            {onResize && panelWidth !== undefined && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize sidebar"
                aria-valuemin={SIDEBAR_MIN_WIDTH}
                aria-valuemax={SIDEBAR_MAX_WIDTH}
                aria-valuenow={panelWidth}
                tabIndex={0}
                title="Drag to resize · double-click to reset"
                onPointerDown={startResize}
                onDoubleClick={() => onResize(SIDEBAR_DEFAULT_WIDTH)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") onResize(clamp(panelWidth - 16));
                  if (e.key === "ArrowRight") onResize(clamp(panelWidth + 16));
                }}
                className={cn(
                  "group/resize absolute -right-[3px] top-0 z-30 h-full w-[6px] cursor-col-resize outline-none",
                  "after:absolute after:inset-y-0 after:left-[2px] after:w-[2px] after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity after:duration-200",
                  "hover:after:opacity-60 focus-visible:after:opacity-100",
                  dragging && "after:opacity-100"
                )}
              />
            )}
            <div className="flex h-11 items-center justify-between gap-2 px-3">
              <p className="truncate text-[13px] font-semibold tracking-tight text-foreground" title={workspace?.name}>
                {workspace?.name ?? "TBB Workspace"}
              </p>
              <IconButton
                aria-label="Collapse sidebar"
                icon={<PanelLeftClose className="h-4 w-4" />}
                variant="ghost"
                size="xs"
                onClick={onToggleCollapse}
                className="text-muted-foreground hover:text-foreground"
              />
            </div>

            <div className="px-3 pb-2">
              <button
                type="button"
                onClick={onOpenSearch}
                className="press group flex h-8 w-full items-center justify-between rounded-control border border-[hsl(var(--surface-glass-border))] bg-background/60 px-2.5 text-[13px] text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <span className="flex items-center gap-2">
                  <Search className="h-3.5 w-3.5" />
                  <span>Search</span>
                </span>
                <kbd className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">Ctrl K</kbd>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-3">
              {can(role, "hierarchy:view") && <SpacesTree collapsed={false} onNavigate={onCloseMobile} />}
            </div>

            {profile && (
              <Link
                to="/profile"
                onClick={onCloseMobile}
                className="flex items-center gap-2 border-t border-[hsl(var(--surface-glass-border))] p-2.5 hover:bg-sidebar-accent"
              >
                <UserAvatar name={profile.fullName} src={profile.avatarUrl ?? undefined} size="xs" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-foreground">{profile.fullName}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{role ? ROLE_LABELS[role] : ""}</span>
                </span>
              </Link>
            )}
          </div>
        )}
      </aside>
    </TooltipProvider>
  );
};

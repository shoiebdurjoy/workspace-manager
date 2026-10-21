import React from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Menu, Search, User, Settings, LogOut, Palette, Users } from "lucide-react";
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
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { BrandMark } from "@/components/brand/Logo";
import ThemeToggle from "@/components/theme/ThemeToggle";
import NotificationBell from "@/components/collaboration/NotificationBell";
import RoleBadge from "@/components/team/RoleBadge";
import { AvailabilityRing, MyStatusButton } from "@/components/team/Availability";
import { useAvailability } from "@/hooks/use-availability";
import { useAuth } from "@/hooks/use-auth";
import { can } from "@/lib/permissions";
import { useHierarchy } from "@/hooks/use-hierarchy";
import { breadcrumbFor } from "@/lib/hierarchy";

export interface AppHeaderProps {
  onToggleMobileSidebar: () => void;
  onOpenSearch: () => void;
}

const PAGE_TITLES: Record<string, string> = {
  "/home": "Home",
  "/everything": "Everything",
  "/my-tasks": "My Tasks",
  "/inbox": "Inbox",
  "/calendar": "Calendar",
  "/workload": "Workload",
  "/production": "Production",
  "/team": "Team",
  "/profile": "Profile",
  "/settings": "Settings",
  "/design-system": "Design System",
};

export const AppHeader: React.FC<AppHeaderProps> = ({ onToggleMobileSidebar, onOpenSearch }) => {
  const { profile, role, workspace, signOut, user } = useAuth();
  const availability = useAvailability();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const { data: tree } = useHierarchy();
  const trail = tree ? breadcrumbFor(tree, params) : [];
  const pageTitle =
    PAGE_TITLES[location.pathname] ?? (location.pathname.startsWith("/everything/") ? "Everything" : trail.length === 0 ? "Overview" : "");

  const onSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <header className="sticky top-0 z-30 flex h-12 w-full items-center justify-between border-b surface-glass px-3 sm:px-4 select-none">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <IconButton
          aria-label="Toggle navigation menu"
          icon={<Menu className="h-4 w-4" />}
          variant="ghost"
          size="sm"
          onClick={onToggleMobileSidebar}
          className="lg:hidden h-9 w-9"
        />
        <Link to="/home" aria-label="TBB Workspace home" className="rounded-md sm:hidden">
          <BrandMark size="sm" />
        </Link>
        <Breadcrumb className="hidden min-w-0 overflow-hidden sm:flex text-xs">
          <BreadcrumbList className="min-w-0 flex-nowrap sm:gap-1.5">
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbLink asChild className="min-w-0 text-muted-foreground hover:text-foreground font-medium truncate max-w-[160px]">
                <Link to="/home">{workspace?.name ?? "TBB Workspace"}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {trail.map((crumb, i) => (
              <React.Fragment key={`${crumb.label}-${i}`}>
                <BreadcrumbSeparator className="[&>svg]:size-3" />
                <BreadcrumbItem className={i === trail.length - 1 ? "shrink-0" : "min-w-0"}>
                  {i === trail.length - 1 ? (
                    <BreadcrumbPage className="font-semibold text-foreground truncate max-w-[180px]">{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild className="text-muted-foreground hover:text-foreground min-w-0 font-medium truncate max-w-[140px]">
                      <Link to={crumb.href ?? "/home"}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            ))}
            {pageTitle && (
              <>
                <BreadcrumbSeparator className="[&>svg]:size-3" />
                <BreadcrumbItem>
                  <BreadcrumbPage className="font-semibold text-foreground truncate max-w-[180px]">{pageTitle}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="mx-4 hidden w-full max-w-md shrink md:block">
        <button
          type="button"
          onClick={onOpenSearch}
          className="press group flex h-8 w-full items-center justify-between rounded-full border border-[hsl(var(--surface-glass-border))] bg-muted/60 px-3.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <span className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5" />
            <span className="truncate">Search or run a command</span>
          </span>
          <kbd className="pointer-events-none hidden rounded-md bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
            Ctrl K
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <IconButton
          aria-label="Search"
          tooltip="Search (⌘K)"
          icon={<Search className="h-4 w-4" />}
          variant="ghost"
          size="sm"
          onClick={onOpenSearch}
          className="md:hidden"
        />

        {can(role, "comments:view-internal") && <MyStatusButton />}

        <NotificationBell />

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account menu"
              className="rounded-full ring-2 ring-transparent hover:ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all p-0.5"
            >
              <AvailabilityRing availability={user ? availability.byUser.get(user.id) : undefined}>
                <UserAvatar name={profile?.fullName} src={profile?.avatarUrl ?? undefined} size="sm" />
              </AvailabilityRing>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-60" align="end" sideOffset={8}>
            <DropdownMenuLabel className="font-normal p-3">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-semibold text-foreground leading-none">{profile?.fullName}</p>
                <p className="text-xs text-muted-foreground truncate">{profile?.email}</p>
                {role && (
                  <div className="pt-1.5">
                    <RoleBadge role={role} />
                  </div>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="cursor-pointer text-xs">
              <Link to="/profile" className="flex items-center">
                <User className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                <span>Profile</span>
              </Link>
            </DropdownMenuItem>
            {can(role, "team:view") && (
              <DropdownMenuItem asChild className="cursor-pointer text-xs">
                <Link to="/team" className="flex items-center">
                  <Users className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                  <span>Team</span>
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild className="cursor-pointer text-xs">
              <Link to="/settings" className="flex items-center">
                <Settings className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                <span>Workspace settings</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="cursor-pointer text-xs">
              <Link to="/design-system" className="flex items-center">
                <Palette className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                <span>Design system</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void onSignOut()}
              className="cursor-pointer text-destructive text-xs focus:text-destructive focus:bg-destructive/10"
            >
              <LogOut className="mr-2 h-3.5 w-3.5" />
              <span>Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

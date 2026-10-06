import React from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Menu, Search, Bell, User, Settings, LogOut, Palette, Users } from "lucide-react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import ThemeToggle from "@/components/theme/ThemeToggle";
import RoleBadge from "@/components/team/RoleBadge";
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
  "/team": "Team",
  "/profile": "Profile",
  "/settings": "Settings",
  "/design-system": "Design System",
};

export const AppHeader: React.FC<AppHeaderProps> = ({ onToggleMobileSidebar, onOpenSearch }) => {
  const { profile, role, workspace, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const { data: tree } = useHierarchy();
  const trail = tree ? breadcrumbFor(tree, params) : [];
  const pageTitle = PAGE_TITLES[location.pathname] ?? (trail.length === 0 ? "Overview" : "");

  const onSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <header className="sticky top-0 z-30 flex h-13 w-full items-center justify-between border-b border-border/70 bg-background/95 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/80 select-none">
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
            <BreadcrumbItem>
              <BreadcrumbLink asChild className="text-muted-foreground hover:text-foreground font-medium truncate max-w-[160px]">
                <Link to="/home">{workspace?.name ?? "TBB Workspace"}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {trail.map((crumb, i) => (
              <React.Fragment key={`${crumb.label}-${i}`}>
                <BreadcrumbSeparator className="[&>svg]:size-3" />
                <BreadcrumbItem>
                  {i === trail.length - 1 ? (
                    <BreadcrumbPage className="font-semibold text-foreground truncate max-w-[180px]">{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild className="text-muted-foreground hover:text-foreground font-medium truncate max-w-[140px]">
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

      <div className="flex-1 max-w-md mx-4 hidden md:block">
        <button
          type="button"
          onClick={onOpenSearch}
          className="w-full flex items-center justify-between h-8 px-3 rounded-lg border border-border/80 bg-muted/40 hover:bg-muted/70 text-xs text-muted-foreground hover:text-foreground transition-all group"
        >
          <span className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground group-hover:text-purple-600 transition-colors" />
            <span className="truncate">Search pages and commands...</span>
          </span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 pointer-events-none rounded border border-border/70 bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            <span className="text-xs">⌘</span>K
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <IconButton
          aria-label="Search"
          tooltip="Search (⌘K)"
          icon={<Search className="h-4 w-4" />}
          variant="ghost"
          size="sm"
          onClick={onOpenSearch}
          className="md:hidden"
        />

        {/* Notification centre arrives in Phase 10; nothing is simulated until then. */}
        <Popover>
          <PopoverTrigger asChild>
            <span>
              <IconButton aria-label="Notifications" tooltip="Notifications" icon={<Bell className="h-4 w-4" />} variant="ghost" size="sm" />
            </span>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-4 text-xs">
            <p className="font-semibold text-foreground">Notifications</p>
            <p className="mt-1 text-muted-foreground">
              You're all caught up. Task notifications (assignments, QC hand-offs, revisions) arrive in Phase 10.
            </p>
          </PopoverContent>
        </Popover>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account menu"
              className="rounded-full ring-2 ring-transparent hover:ring-purple-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 transition-all p-0.5"
            >
              <UserAvatar name={profile?.fullName} src={profile?.avatarUrl ?? undefined} size="sm" />
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
                <Palette className="mr-2 h-3.5 w-3.5 text-pink-500" />
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

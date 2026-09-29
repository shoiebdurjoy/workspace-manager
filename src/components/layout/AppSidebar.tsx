import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  CheckSquare,
  Inbox,
  UserCheck,
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Settings,
  HelpCircle,
  Folder,
  ListTodo,
  Layers,
  Sparkles,
  CreditCard,
  BarChart3,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Logo from "@/components/brand/Logo";
import { IconButton } from "@/components/ui/icon-button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/context/AuthContext";
import { useAllWorkspaces } from "@/hooks/use-workspaces";

export interface AppSidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onOpenSearch: () => void;
  className?: string;
  onCloseMobile?: () => void;
}

interface DemoSpaceItem {
  id: string;
  name: string;
  color: string;
  folders?: {
    id: string;
    name: string;
    lists: {
      id: string;
      name: string;
      taskCount?: number;
    }[];
  }[];
  standaloneLists?: {
    id: string;
    name: string;
    taskCount?: number;
  }[];
}

// Demonstrates the ClickUp 6-level hierarchy (Workspace -> Space -> Folder -> List -> Task -> Subtask)
const DEMO_HIERARCHY: DemoSpaceItem[] = [
  {
    id: "space-client-video",
    name: "Client Video Production",
    color: "from-purple-500 to-indigo-500",
    folders: [
      {
        id: "folder-edaptx",
        name: "25. EDAPTX",
        lists: [
          { id: "list-edaptx-long", name: "Long-Form Tech Reviews", taskCount: 8 },
          { id: "list-edaptx-shorts", name: "Shorts & Highlights", taskCount: 14 },
        ],
      },
      {
        id: "folder-krav",
        name: "26. KRAV_FITNESS",
        lists: [
          { id: "list-krav-master", name: "Workout Masterclass", taskCount: 6 },
        ],
      },
    ],
    standaloneLists: [
      { id: "list-incoming-raw", name: "Raw Footage Intake", taskCount: 3 },
    ],
  },
  {
    id: "space-social",
    name: "Shorts & Social Pipeline",
    color: "from-pink-500 to-rose-500",
    standaloneLists: [
      { id: "list-daily-reels", name: "Daily Instagram Reels", taskCount: 12 },
      { id: "list-tiktok", name: "TikTok Content Hub", taskCount: 9 },
    ],
  },
  {
    id: "space-design",
    name: "Design & Thumbnails",
    color: "from-amber-500 to-orange-500",
    standaloneLists: [
      { id: "list-yt-thumbs", name: "YouTube Master Thumbnails", taskCount: 5 },
    ],
  },
];

export const AppSidebar: React.FC<AppSidebarProps> = ({
  isCollapsed,
  onToggleCollapse,
  onOpenSearch,
  className,
  onCloseMobile,
}) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { data: realWorkspaces } = useAllWorkspaces();

  // State for expanded spaces and folders
  const [expandedSpaces, setExpandedSpaces] = useState<Record<string, boolean>>({
    "space-client-video": true,
    "space-social": false,
  });
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    "folder-edaptx": true,
  });

  const isAuthor = currentUser?.role === "AUTHOR";

  const toggleSpace = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedSpaces((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleFolder = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleNavClick = (href: string) => {
    navigate(href);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  const primaryNavItems = [
    {
      label: "Home",
      icon: Home,
      href: "/dashboard",
      active: pathname === "/dashboard" || pathname === "/",
    },
    {
      label: "Inbox",
      icon: Inbox,
      href: "/dashboard", // placeholder to demonstrate ClickUp inbox nav
      badge: "2",
      active: false,
    },
    {
      label: "My Tasks",
      icon: UserCheck,
      href: "/tasks",
      active: false,
    },
    {
      label: "Everything",
      icon: CheckSquare,
      href: "/tasks",
      active: pathname === "/tasks",
    },
  ];

  const adminNavItems = [
    ...(isAuthor
      ? [
          {
            label: "Team",
            icon: Users,
            href: "/employees",
            active: pathname.startsWith("/employees"),
          },
        ]
      : []),
    {
      label: "Payments",
      icon: CreditCard,
      href: "/payments",
      active: pathname.startsWith("/payments"),
    },
    {
      label: "Reports",
      icon: BarChart3,
      href: "/reports",
      active: pathname.startsWith("/reports"),
    },
    {
      label: "Settings",
      icon: Settings,
      href: "/settings",
      active: pathname.startsWith("/settings"),
    },
  ];

  return (
    <TooltipProvider delayDuration={150}>
      <aside
        className={cn(
          "flex flex-col border-r border-border/70 bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out select-none relative z-20 shrink-0",
          isCollapsed ? "w-16" : "w-64",
          className
        )}
      >
        {/* Top Header / Brand */}
        <div className="flex h-13 items-center justify-between px-3 border-b border-border/60">
          {!isCollapsed ? (
            <Link
              to="/dashboard"
              className="flex items-center gap-2 overflow-hidden hover:opacity-90 transition-opacity"
              onClick={onCloseMobile}
            >
              <Logo size="sm" />
            </Link>
          ) : (
            <div className="mx-auto">
              <Link to="/dashboard" onClick={onCloseMobile}>
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

        {/* Search trigger inside sidebar when expanded */}
        {!isCollapsed && (
          <div className="px-3 pt-3">
            <button
              type="button"
              onClick={onOpenSearch}
              className="w-full flex items-center justify-between h-8 px-2.5 rounded-lg border border-border/70 bg-muted/40 hover:bg-muted/70 text-xs text-muted-foreground hover:text-foreground transition-colors group"
            >
              <div className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground group-hover:text-purple-600 transition-colors" />
                <span>Search</span>
              </div>
              <kbd className="inline-flex items-center gap-0.5 rounded border border-border/60 bg-background px-1 py-0.2 text-[10px] font-mono text-muted-foreground">
                ⌘K
              </kbd>
            </button>
          </div>
        )}

        {/* Scrollable Navigation Area */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          {/* Core Navigation Items */}
          <div className="space-y-0.5">
            {primaryNavItems.map((item) => {
              const navBtn = (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => handleNavClick(item.href)}
                  className={cn(
                    "flex items-center rounded-lg text-xs font-medium transition-all group w-full",
                    isCollapsed ? "h-9 w-9 justify-center mx-auto" : "h-8 px-2.5 justify-between",
                    item.active
                      ? "bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <item.icon
                      className={cn(
                        "h-4 w-4 shrink-0 transition-colors",
                        item.active
                          ? "text-purple-600 dark:text-purple-400"
                          : "text-muted-foreground group-hover:text-foreground"
                      )}
                    />
                    {!isCollapsed && <span className="truncate">{item.label}</span>}
                  </div>
                  {!isCollapsed && item.badge && (
                    <span className="text-[10px] font-bold px-1.5 py-0.2 bg-purple-600 text-white rounded-full">
                      {item.badge}
                    </span>
                  )}
                </button>
              );

              if (isCollapsed) {
                return (
                  <Tooltip key={item.label}>
                    <TooltipTrigger asChild>{navBtn}</TooltipTrigger>
                    <TooltipContent side="right" className="font-semibold text-xs">
                      {item.label} {item.badge && `(${item.badge})`}
                    </TooltipContent>
                  </Tooltip>
                );
              }

              return navBtn;
            })}
          </div>

          {/* SPACES HIERARCHY SECTION (ClickUp 6-level architecture) */}
          {!isCollapsed ? (
            <div className="pt-2 border-t border-border/50 space-y-1">
              <div className="flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Layers className="h-3 w-3" />
                  Spaces
                </span>
                {isAuthor && (
                  <button
                    type="button"
                    onClick={() => {
                      navigate("/workspaces/new");
                      if (onCloseMobile) onCloseMobile();
                    }}
                    className="hover:text-purple-600 transition-colors p-0.5 rounded hover:bg-muted"
                    title="Create Space"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Spaces Tree */}
              <div className="space-y-1 pt-1">
                {DEMO_HIERARCHY.map((space) => {
                  const isSpaceOpen = expandedSpaces[space.id] ?? false;

                  return (
                    <div key={space.id} className="space-y-0.5">
                      {/* Space Header Row */}
                      <button
                        type="button"
                        onClick={(e) => toggleSpace(space.id, e)}
                        className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs hover:bg-muted/50 text-foreground font-medium group transition-colors"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span
                            className={cn(
                              "h-2 w-2 rounded-full bg-gradient-to-r shrink-0",
                              space.color
                            )}
                          />
                          <span className="truncate text-xs">{space.name}</span>
                        </div>
                        <span className="text-muted-foreground group-hover:text-foreground">
                          {isSpaceOpen ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </span>
                      </button>

                      {/* Space Children (Folders and Lists) */}
                      {isSpaceOpen && (
                        <div className="ml-3 pl-2 border-l border-border/60 space-y-1 py-0.5">
                          {/* Folders */}
                          {space.folders?.map((folder) => {
                            const isFolderOpen = expandedFolders[folder.id] ?? false;

                            return (
                              <div key={folder.id} className="space-y-0.5">
                                <button
                                  type="button"
                                  onClick={(e) => toggleFolder(folder.id, e)}
                                  className="w-full flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors group"
                                >
                                  <div className="flex items-center gap-1.5 truncate">
                                    <Folder className="h-3 w-3 text-muted-foreground group-hover:text-purple-500" />
                                    <span className="truncate">{folder.name}</span>
                                  </div>
                                  <span>
                                    {isFolderOpen ? (
                                      <ChevronDown className="h-3 w-3" />
                                    ) : (
                                      <ChevronRight className="h-3 w-3" />
                                    )}
                                  </span>
                                </button>

                                {/* Lists inside Folder */}
                                {isFolderOpen && (
                                  <div className="ml-3 pl-2 border-l border-border/40 space-y-0.5">
                                    {folder.lists.map((list) => (
                                      <button
                                        key={list.id}
                                        type="button"
                                        onClick={() => handleNavClick("/tasks")}
                                        className="w-full flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-muted-foreground hover:text-purple-600 hover:bg-purple-50/50 dark:hover:bg-purple-950/30 transition-colors group"
                                      >
                                        <div className="flex items-center gap-1.5 truncate">
                                          <ListTodo className="h-3 w-3 text-muted-foreground group-hover:text-purple-500" />
                                          <span className="truncate">{list.name}</span>
                                        </div>
                                        {list.taskCount !== undefined && (
                                          <span className="text-[10px] text-muted-foreground font-mono">
                                            {list.taskCount}
                                          </span>
                                        )}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {/* Standalone Lists directly in Space */}
                          {space.standaloneLists?.map((list) => (
                            <button
                              key={list.id}
                              type="button"
                              onClick={() => handleNavClick("/tasks")}
                              className="w-full flex items-center justify-between px-1.5 py-1 rounded text-[11px] text-muted-foreground hover:text-purple-600 hover:bg-purple-50/50 dark:hover:bg-purple-950/30 transition-colors group"
                            >
                              <div className="flex items-center gap-1.5 truncate">
                                <ListTodo className="h-3 w-3 text-muted-foreground group-hover:text-purple-500" />
                                <span className="truncate">{list.name}</span>
                              </div>
                              {list.taskCount !== undefined && (
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  {list.taskCount}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Show any backend spaces if present */}
                {realWorkspaces && realWorkspaces.length > 0 && (
                  <div className="pt-1 border-t border-border/40">
                    <p className="px-2 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/80 font-mono">
                      Connected DB Workspaces
                    </p>
                    {realWorkspaces.map((ws) => (
                      <button
                        key={ws.id}
                        type="button"
                        onClick={() => handleNavClick(`/workspaces/${ws.id}`)}
                        className="w-full flex items-center justify-between px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 truncate"
                      >
                        <span className="truncate">{ws.name}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {ws.members.length}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Collapsed Spaces Icon */
            <div className="pt-2 border-t border-border/50 flex justify-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => handleNavClick("/workspaces")}
                    className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <Layers className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="font-semibold text-xs">
                  Spaces & Lists
                </TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Admin & Tools Section */}
          <div className="pt-2 border-t border-border/50 space-y-0.5">
            {!isCollapsed && (
              <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Management
              </p>
            )}
            {adminNavItems.map((item) => {
              const adminBtn = (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => handleNavClick(item.href)}
                  className={cn(
                    "flex items-center rounded-lg text-xs font-medium transition-all group w-full",
                    isCollapsed ? "h-9 w-9 justify-center mx-auto" : "h-8 px-2.5 justify-start gap-2.5",
                    item.active
                      ? "bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  <item.icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      item.active
                        ? "text-purple-600 dark:text-purple-400"
                        : "text-muted-foreground group-hover:text-foreground"
                    )}
                  />
                  {!isCollapsed && <span className="truncate">{item.label}</span>}
                </button>
              );

              if (isCollapsed) {
                return (
                  <Tooltip key={item.label}>
                    <TooltipTrigger asChild>{adminBtn}</TooltipTrigger>
                    <TooltipContent side="right" className="font-semibold text-xs">
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                );
              }

              return adminBtn;
            })}
          </div>
        </div>

        {/* Sidebar Footer User & Status */}
        {!isCollapsed && (
          <div className="p-2.5 border-t border-border/60 bg-muted/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-7 w-7 rounded-full bg-purple-600/20 text-purple-700 dark:text-purple-300 flex items-center justify-center font-bold text-xs shrink-0">
                  {currentUser?.name?.charAt(0) || "T"}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {currentUser?.name || "TBB User"}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] text-muted-foreground truncate">
                      {currentUser?.role === "AUTHOR" ? "Administrator" : "Online"}
                    </span>
                  </div>
                </div>
              </div>

              <IconButton
                aria-label="Documentation & Help"
                tooltip="Help & Shortcuts"
                icon={<HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />}
                variant="ghost"
                size="xs"
                onClick={() => handleNavClick("/design-system")}
              />
            </div>
          </div>
        )}
      </aside>
    </TooltipProvider>
  );
};

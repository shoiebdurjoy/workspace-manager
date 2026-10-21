import React, { useState, useEffect } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppHeader } from "@/components/layout/AppHeader";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useLocation } from "react-router-dom";
import { PageTransition } from "@/components/motion";
import { cn } from "@/lib/utils";

export interface AppShellProps {
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = "tbb_sidebar_collapsed";

export const AppShell: React.FC<AppShellProps> = ({
  children,
  className,
  noPadding = false,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(
        SIDEBAR_COLLAPSED_STORAGE_KEY,
        isCollapsed ? "true" : "false"
      );
    } catch {
      // ignore localStorage errors
    }
  }, [isCollapsed]);

  const toggleCollapse = () => {
    setIsCollapsed((prev) => !prev);
  };

  // a task opened over a view is not a new page: the view stays put, only the sheet animates
  const { pathname } = useLocation();
  const pageKey = pathname.replace(/\/tasks\/[^/]+$/, "");

  return (
    <div className="flex h-screen w-full overflow-hidden surface-canvas text-foreground antialiased">
      {/* Desktop Persistent Sidebar */}
      <div className="hidden lg:flex shrink-0">
        <AppSidebar
          isCollapsed={isCollapsed}
          onToggleCollapse={toggleCollapse}
          onOpenSearch={() => setIsSearchOpen(true)}
        />
      </div>

      {/* Mobile Drawer Sidebar */}
      <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
        <SheetContent side="left" className="surface-glass !bg-sidebar p-0 w-[19.5rem] max-w-[88vw] border-r">
          <AppSidebar
            isCollapsed={false}
            onToggleCollapse={() => setIsMobileOpen(false)}
            onOpenSearch={() => {
              setIsMobileOpen(false);
              setIsSearchOpen(true);
            }}
            onCloseMobile={() => setIsMobileOpen(false)}
            className="w-full h-full border-none"
          />
        </SheetContent>
      </Sheet>

      {/* Main Workspace Frame */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Top Header */}
        <AppHeader
          onToggleMobileSidebar={() => setIsMobileOpen(true)}
          onOpenSearch={() => setIsSearchOpen(true)}
        />

        {/* Scrollable Content Container */}
        <main
          className={cn(
            "flex-1 overflow-y-auto surface-canvas focus:outline-none",
            noPadding ? "p-0" : "px-3 py-3 sm:px-4 lg:px-6 lg:py-4",
            className
          )}
        >
          <div className="w-full">
            <PageTransition routeKey={pageKey}>{children}</PageTransition>
          </div>
        </main>
      </div>

      {/* Global Command Palette (⌘K) */}
      <CommandPalette
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
      />
    </div>
  );
};

export default AppShell;

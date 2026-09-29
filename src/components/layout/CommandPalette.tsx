import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Home,
  CheckSquare,
  Briefcase,
  Settings,
  User,
  CreditCard,
  BarChart3,
  Palette,
  Plus,
  Moon,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onQuickTask?: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onOpenChange,
  onQuickTask,
}) => {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  // Listen for Ctrl+K or Cmd+K
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  const runCommand = (command: () => void) => {
    onOpenChange(false);
    command();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search workspace..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem
            onSelect={() => runCommand(() => navigate("/dashboard"))}
            className="cursor-pointer"
          >
            <Home className="mr-2 h-4 w-4 text-purple-600" />
            <span>Home</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate("/tasks"))}
            className="cursor-pointer"
          >
            <CheckSquare className="mr-2 h-4 w-4 text-purple-600" />
            <span>Everything / Tasks</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate("/workspaces"))}
            className="cursor-pointer"
          >
            <Briefcase className="mr-2 h-4 w-4 text-purple-600" />
            <span>Workspaces & Spaces</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate("/payments"))}
            className="cursor-pointer"
          >
            <CreditCard className="mr-2 h-4 w-4 text-purple-600" />
            <span>Payments</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate("/reports"))}
            className="cursor-pointer"
          >
            <BarChart3 className="mr-2 h-4 w-4 text-purple-600" />
            <span>Reports & Analytics</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick Actions">
          {onQuickTask && (
            <CommandItem
              onSelect={() => runCommand(() => onQuickTask())}
              className="cursor-pointer"
            >
              <Plus className="mr-2 h-4 w-4 text-emerald-600" />
              <span>Create New Task</span>
            </CommandItem>
          )}
          <CommandItem
            onSelect={() =>
              runCommand(() => setTheme(theme === "dark" ? "light" : "dark"))
            }
            className="cursor-pointer"
          >
            {theme === "dark" ? (
              <Sun className="mr-2 h-4 w-4 text-amber-500" />
            ) : (
              <Moon className="mr-2 h-4 w-4 text-indigo-500" />
            )}
            <span>Toggle Dark/Light Mode</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Design & Developer">
          <CommandItem
            onSelect={() => runCommand(() => navigate("/design-system"))}
            className="cursor-pointer"
          >
            <Palette className="mr-2 h-4 w-4 text-pink-500" />
            <span>Design System & UI Primitives Showcase</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate("/profile"))}
            className="cursor-pointer"
          >
            <User className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>My Profile</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate("/settings"))}
            className="cursor-pointer"
          >
            <Settings className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Workspace Settings</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};

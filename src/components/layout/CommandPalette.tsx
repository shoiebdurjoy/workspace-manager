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
import { Home, Settings, User, Users, Palette, MailPlus, UsersRound, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { can } from "@/lib/permissions";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * ⌘K / Ctrl+K palette. In Phase 4 it navigates between real pages only; searching clients,
 * lists and tasks is Phase 9.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onOpenChange }) => {
  const navigate = useNavigate();
  const { role, signOut } = useAuth();

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

  const run = (command: () => void) => {
    onOpenChange(false);
    command();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Go to a page or run a command..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => run(() => navigate("/home"))} className="cursor-pointer">
            <Home className="mr-2 h-4 w-4 text-purple-600" />
            <span>Home</span>
          </CommandItem>
          {can(role, "team:view") && (
            <>
              <CommandItem onSelect={() => run(() => navigate("/team"))} className="cursor-pointer">
                <Users className="mr-2 h-4 w-4 text-purple-600" />
                <span>Team members</span>
              </CommandItem>
              <CommandItem onSelect={() => run(() => navigate("/team?tab=pods"))} className="cursor-pointer">
                <UsersRound className="mr-2 h-4 w-4 text-purple-600" />
                <span>Pods</span>
              </CommandItem>
            </>
          )}
          {can(role, "users:invite") && (
            <CommandItem onSelect={() => run(() => navigate("/team?tab=invitations"))} className="cursor-pointer">
              <MailPlus className="mr-2 h-4 w-4 text-purple-600" />
              <span>Invite someone</span>
            </CommandItem>
          )}
          <CommandItem onSelect={() => run(() => navigate("/profile"))} className="cursor-pointer">
            <User className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>My profile</span>
          </CommandItem>
          <CommandItem onSelect={() => run(() => navigate("/settings"))} className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Workspace settings</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="More">
          <CommandItem onSelect={() => run(() => navigate("/design-system"))} className="cursor-pointer">
            <Palette className="mr-2 h-4 w-4 text-pink-500" />
            <span>Design system</span>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => {
                void signOut().then(() => navigate("/login", { replace: true }));
              })
            }
            className="cursor-pointer"
          >
            <LogOut className="mr-2 h-4 w-4 text-destructive" />
            <span>Sign out</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};

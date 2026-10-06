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
import { Home, Settings, User, Users, Palette, MailPlus, UsersRound, LogOut, Folder, ListTodo } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useHierarchy } from "@/hooks/use-hierarchy";
import { can } from "@/lib/permissions";
import { hierarchyPaths } from "@/lib/hierarchy";
import SpaceIcon from "@/components/hierarchy/SpaceIcon";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * ⌘K / Ctrl+K palette. It jumps between real pages and the workspace's real spaces, folders
 * and lists. Searching tasks and filtering is Phase 9.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onOpenChange }) => {
  const navigate = useNavigate();
  const { role, signOut } = useAuth();
  const { data: tree } = useHierarchy();

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
            <Home className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Home</span>
          </CommandItem>
          {can(role, "team:view") && (
            <>
              <CommandItem onSelect={() => run(() => navigate("/team"))} className="cursor-pointer">
                <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>Team members</span>
              </CommandItem>
              <CommandItem onSelect={() => run(() => navigate("/team?tab=pods"))} className="cursor-pointer">
                <UsersRound className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>Pods</span>
              </CommandItem>
            </>
          )}
          {can(role, "users:invite") && (
            <CommandItem onSelect={() => run(() => navigate("/team?tab=invitations"))} className="cursor-pointer">
              <MailPlus className="mr-2 h-4 w-4 text-muted-foreground" />
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
        {tree && tree.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Spaces, folders and lists">
              {tree.map((space) => (
                <React.Fragment key={space.id}>
                  <CommandItem
                    value={`space ${space.name}`}
                    onSelect={() => run(() => navigate(hierarchyPaths.space(space.id)))}
                    className="cursor-pointer"
                  >
                    <SpaceIcon icon={space.icon} color={space.color} size="sm" className="mr-2" />
                    <span>{space.name}</span>
                  </CommandItem>
                  {space.folders.map((folder) => (
                    <CommandItem
                      key={folder.id}
                      value={`folder ${space.name} ${folder.name}`}
                      onSelect={() => run(() => navigate(hierarchyPaths.folder(space.id, folder.id)))}
                      className="cursor-pointer"
                    >
                      <Folder className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>
                        {folder.name} <span className="text-xs text-muted-foreground">in {space.name}</span>
                      </span>
                    </CommandItem>
                  ))}
                  {[
                    ...space.folders.flatMap((f) => f.lists.map((list) => ({ list, parent: f.name }))),
                    ...space.folderlessLists.map((list) => ({ list, parent: space.name })),
                  ].map(({ list, parent }) => (
                    <CommandItem
                      key={list.id}
                      value={`list ${space.name} ${parent} ${list.name}`}
                      onSelect={() => run(() => navigate(hierarchyPaths.list(space.id, list.id)))}
                      className="cursor-pointer"
                    >
                      <ListTodo className="mr-2 h-4 w-4" style={{ color: list.color }} />
                      <span>
                        {list.name} <span className="text-xs text-muted-foreground">in {parent}</span>
                      </span>
                    </CommandItem>
                  ))}
                </React.Fragment>
              ))}
            </CommandGroup>
          </>
        )}
        <CommandSeparator />
        <CommandGroup heading="More">
          <CommandItem onSelect={() => run(() => navigate("/design-system"))} className="cursor-pointer">
            <Palette className="mr-2 h-4 w-4 text-muted-foreground" />
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

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
import { CheckSquare, Home, Inbox, UserCheck, Settings, User, Users, Palette, MailPlus, UsersRound, LogOut, Folder, ListTodo, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useHierarchy } from "@/hooks/use-hierarchy";
import { can } from "@/lib/permissions";
import { findListById, hierarchyPaths } from "@/lib/hierarchy";
import { FINDER_MIN_CHARS, useTaskFinder } from "@/hooks/use-task-finder";
import { TaskStatusPill } from "@/components/tasks/TaskBadges";
import SpaceIcon from "@/components/hierarchy/SpaceIcon";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * ⌘K / Ctrl+K palette. It jumps between real pages and the workspace's real spaces, folders and
 * lists, and finds any task: once two letters are typed the database is asked (title, short id, list,
 * folder, space and people's names) and the best few matches are listed under the pages.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onOpenChange }) => {
  const navigate = useNavigate();
  const { role, signOut } = useAuth();
  const { data: tree } = useHierarchy();
  const [text, setText] = React.useState("");
  const finder = useTaskFinder(text, open);

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

  React.useEffect(() => {
    if (!open) setText("");
  }, [open]);

  const run = (command: () => void) => {
    onOpenChange(false);
    command();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput value={text} onValueChange={setText} placeholder="Find a task, or go to a page..." />
      <CommandList>
        {/* cmdk does not count the task results (they are always shown), so only claim "nothing" when there are none */}
        {finder.tasks.length === 0 && <CommandEmpty>{finder.isFetching ? "Searching..." : "No results found."}</CommandEmpty>}
        {can(role, "hierarchy:view") && finder.tasks.length > 0 && (
          <>
            <CommandGroup forceMount heading={`Tasks${finder.total > finder.tasks.length ? ` (${finder.tasks.length} of ${finder.total})` : ""}`}>
              {finder.tasks.map((task) => {
                const place = tree ? findListById(tree, task.listId) : undefined;
                return (
                  <CommandItem
                    key={task.id}
                    forceMount
                    value={`task ${task.id}`}
                    onSelect={() =>
                      run(() =>
                        navigate(place ? hierarchyPaths.task(place.space.id, place.list.id, task.id) : hierarchyPaths.taskById(task.id))
                      )
                    }
                    className="cursor-pointer gap-2"
                  >
                    <CheckSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{task.title}</span>
                      {place && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {[place.space.name, place.folder?.name, place.list.name].filter(Boolean).join(" / ")}
                        </span>
                      )}
                    </span>
                    <TaskStatusPill status={task.status} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        {finder.isFetching && finder.term.length >= FINDER_MIN_CHARS && finder.tasks.length === 0 && (
          <div role="status" className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> Searching tasks...
          </div>
        )}
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => run(() => navigate("/home"))} className="cursor-pointer">
            <Home className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Home</span>
          </CommandItem>
          {can(role, "comments:view-internal") && (
            <CommandItem onSelect={() => run(() => navigate("/inbox"))} className="cursor-pointer">
              <Inbox className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Inbox</span>
            </CommandItem>
          )}
          {can(role, "hierarchy:view") && (
            <CommandItem onSelect={() => run(() => navigate(hierarchyPaths.myTasks()))} className="cursor-pointer">
              <UserCheck className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>My Tasks</span>
            </CommandItem>
          )}
          {can(role, "hierarchy:view") && (
            <CommandItem onSelect={() => run(() => navigate(hierarchyPaths.everything()))} className="cursor-pointer">
              <CheckSquare className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Everything (all tasks)</span>
            </CommandItem>
          )}
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
      <div aria-hidden className="flex items-center gap-4 border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><kbd className="rounded border border-border bg-muted px-1 font-mono">↑↓</kbd> navigate</span>
        <span className="inline-flex items-center gap-1"><kbd className="rounded border border-border bg-muted px-1 font-mono">↵</kbd> open</span>
        <span className="inline-flex items-center gap-1"><kbd className="rounded border border-border bg-muted px-1 font-mono">esc</kbd> close</span>
      </div>
    </CommandDialog>
  );
};

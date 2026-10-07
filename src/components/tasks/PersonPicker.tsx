import React, { useState } from 'react';
import { Check, ChevronsUpDown, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { UserAvatar } from '@/components/ui/user-avatar';
import { ROLE_LABELS } from '@/lib/permissions';
import { eligibleAssignees } from '@/lib/tasks';
import type { AssigneeRole, WorkspaceMember } from '@/types/database';

interface PersonPickerProps {
  id?: string;
  slot: AssigneeRole;
  /** Accessible name, e.g. "Editor". */
  label: string;
  value: string | null;
  members: readonly WorkspaceMember[];
  /** The person in the OTHER slot: not offered, because nobody QC's their own cut. */
  otherSlotUserId: string | null;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  /** "field" is a bordered form control (dialogs); "ghost" looks like text until hovered (the detail sheet). */
  variant?: 'field' | 'ghost';
  className?: string;
}

/**
 * Pick the person for one slot, with search. Only people the database would accept are offered;
 * the current person is always shown (even if they have since left or changed role), so the
 * control never displays a blank. A server-side rule still has the final say.
 */
const PersonPicker: React.FC<PersonPickerProps> = ({
  id,
  slot,
  label,
  value,
  members,
  otherSlotUserId,
  onChange,
  disabled,
  variant = 'field',
  className,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const eligible = eligibleAssignees(members, slot, otherSlotUserId);
  const options = eligible.filter(
    (m) => !needle || `${m.profile?.fullName ?? ''} ${ROLE_LABELS[m.role]}`.toLowerCase().includes(needle)
  );
  const current = value ? members.find((m) => m.userId === value) : undefined;
  const currentName = current?.profile?.fullName ?? (value ? 'Former member' : null);
  // judged against everyone eligible, not the search result, or the current person would appear "missing" while searching
  const showCurrentExtra = !!value && !eligible.some((m) => m.userId === value);

  const choose = (userId: string | null) => {
    setOpen(false);
    if (userId !== value) onChange(userId);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // start each visit with an empty search (resetting on close would flash the full list while it fades out)
        if (next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
          className={cn(
            'flex w-full min-w-0 items-center gap-2 rounded-md text-left text-sm outline-none transition-colors',
            'focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
            variant === 'field'
              ? 'h-9 border border-input bg-background px-3 hover:bg-muted/40'
              : 'h-8 border border-transparent px-2 hover:bg-muted data-[state=open]:bg-muted',
            className
          )}
        >
          {value ? (
            <UserAvatar name={currentName ?? undefined} src={current?.profile?.avatarUrl ?? undefined} size="xs" />
          ) : (
            <span aria-hidden className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
              <UserRound className="h-3 w-3" />
            </span>
          )}
          <span className={cn('min-w-0 flex-1 truncate', !value && 'text-muted-foreground')}>{currentName ?? 'Unassigned'}</span>
          <ChevronsUpDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[260px] p-0">
        {/* Filtering is done above as a plain substring match; fuzzy matching surfaces unrelated people. */}
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search people..." aria-label={`Search ${label.toLowerCase()}`} />
          <CommandList>
            {options.length === 0 && needle && !showCurrentExtra && <div className="px-3 py-6 text-center text-sm text-muted-foreground">No one matches.</div>}
            <CommandGroup>
              {(!needle || 'unassigned'.includes(needle)) && (
              <CommandItem value="__unassigned__" onSelect={() => choose(null)}>
                <span className="flex-1 text-muted-foreground">Unassigned</span>
                {!value && <Check aria-hidden className="h-4 w-4" />}
              </CommandItem>
              )}
              {showCurrentExtra && (!needle || (currentName ?? '').toLowerCase().includes(needle)) && (
                <CommandItem value={`${currentName} current`} onSelect={() => choose(value)}>
                  <span className="flex-1">{currentName}</span>
                  <Check aria-hidden className="h-4 w-4" />
                </CommandItem>
              )}
              {options.map((m) => (
                <CommandItem
                  key={m.userId}
                  value={`${m.profile?.fullName ?? ''} ${ROLE_LABELS[m.role]} ${m.userId}`}
                  onSelect={() => choose(m.userId)}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <UserAvatar name={m.profile?.fullName} src={m.profile?.avatarUrl ?? undefined} size="xs" />
                    <span className="truncate">{m.profile?.fullName ?? m.userId}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{ROLE_LABELS[m.role]}</span>
                  </span>
                  {m.userId === value && <Check aria-hidden className="h-4 w-4" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default PersonPicker;

/** The same person, as plain text, for people who may not change the assignment. */
export const PersonValue: React.FC<{ userId: string | null; members: readonly WorkspaceMember[] }> = ({ userId, members }) => {
  if (!userId) return <span className="flex h-8 items-center px-2 text-sm text-muted-foreground">Unassigned</span>;
  const member = members.find((m) => m.userId === userId);
  const name = member?.profile?.fullName ?? 'Former member';
  return (
    <span className="flex h-8 min-w-0 items-center gap-2 px-2 text-sm">
      <UserAvatar name={name} src={member?.profile?.avatarUrl ?? undefined} size="xs" />
      <span className="truncate">{name}</span>
    </span>
  );
};

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserAvatar } from '@/components/ui/user-avatar';
import { ROLE_LABELS } from '@/lib/permissions';
import { eligibleAssignees } from '@/lib/tasks';
import type { AssigneeRole, WorkspaceMember } from '@/types/database';

const NONE = '__none__';

interface AssigneeSelectProps {
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
  className?: string;
}

/**
 * Pick the person for one slot. Only people the database would accept are offered; the current
 * person is always shown (even if they have since left or changed role) so the control never
 * displays a blank. A server-side rule still has the final say.
 */
const AssigneeSelect: React.FC<AssigneeSelectProps> = ({
  id,
  slot,
  label,
  value,
  members,
  otherSlotUserId,
  onChange,
  disabled,
  className,
}) => {
  const options = eligibleAssignees(members, slot, otherSlotUserId);
  const current = value ? members.find((m) => m.userId === value) : undefined;
  const showCurrentExtra = value && !options.some((m) => m.userId === value);

  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} className={className ?? 'h-9 text-sm'}>
        <SelectValue placeholder="Unassigned" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Unassigned</SelectItem>
        {showCurrentExtra && (
          <SelectItem value={value}>{current?.profile?.fullName ?? 'Former member'}</SelectItem>
        )}
        {options.map((m) => (
          <SelectItem key={m.userId} value={m.userId}>
            <span className="flex items-center gap-2">
              <UserAvatar name={m.profile?.fullName} src={m.profile?.avatarUrl ?? undefined} size="xs" />
              <span>{m.profile?.fullName ?? m.userId}</span>
              <span className="text-[11px] text-muted-foreground">{ROLE_LABELS[m.role]}</span>
            </span>
          </SelectItem>
        ))}
        {options.length === 0 && !showCurrentExtra && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No one is available for this role yet.</div>
        )}
      </SelectContent>
    </Select>
  );
};

export default AssigneeSelect;

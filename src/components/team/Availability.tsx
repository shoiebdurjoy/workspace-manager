import React, { useState } from 'react';
import { CalendarDays, Check, Coffee, Flame, Loader2, Palmtree, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAvailability, useSetMyAvailability } from '@/hooks/use-availability';
import { useAuth } from '@/hooks/use-auth';
import {
  AVAILABILITY_META,
  AVAILABILITY_STATUSES,
  NO_STATUS_TONE,
  NOTE_MAX,
  backOnLabel,
  validateNote,
  type Availability,
  type AvailabilityStatus,
} from '@/lib/availability';
import { timeAgo } from '@/lib/collaboration';

export const AVAILABILITY_ICONS: Record<AvailabilityStatus, React.ComponentType<{ className?: string }>> = {
  AVAILABLE: Zap,
  WORKING: Coffee,
  BUSY: Flame,
  ON_LEAVE: Palmtree,
};

const toneOf = (a: Availability | undefined) => (a ? AVAILABILITY_META[a.status].tone : NO_STATUS_TONE);

/** A small status dot to pin on an avatar (bottom-right). Pulses softly for "Available". */
export const AvailabilityDot: React.FC<{ availability: Availability | undefined; className?: string; size?: 'sm' | 'md' }> = ({ availability, className, size = 'sm' }) => {
  if (!availability) return null;
  const meta = AVAILABILITY_META[availability.status];
  return (
    <span
      role="img"
      aria-label={meta.label}
      title={meta.label + (availability.note ? ` · ${availability.note}` : '')}
      className={cn(
        'absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-[hsl(var(--card))]',
        size === 'sm' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5',
        availability.status === 'AVAILABLE' && 'availability-live',
        className
      )}
      style={{ background: `hsl(${meta.tone})`, ['--tone' as string]: meta.tone }}
    />
  );
};

/** A colored ring around an avatar in the person's status color. Wrap the avatar with it. */
export const AvailabilityRing: React.FC<{ availability: Availability | undefined; children: React.ReactNode; className?: string }> = ({ availability, children, className }) => (
  <span
    className={cn('relative inline-flex rounded-full p-[2px] transition-shadow duration-300', className)}
    style={{ boxShadow: availability ? `0 0 0 2px hsl(${toneOf(availability)})` : undefined }}
  >
    {children}
    <AvailabilityDot availability={availability} />
  </span>
);

/** The status chip for the Team page: icon, label, note, return date and how long ago it was set. */
export const AvailabilityChip: React.FC<{ availability: Availability | undefined; className?: string }> = ({ availability, className }) => {
  if (!availability) return <span className={cn('inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground', className)}>No status</span>;
  const meta = AVAILABILITY_META[availability.status];
  const Icon = AVAILABILITY_ICONS[availability.status];
  const back = backOnLabel(availability.backOn);
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1.5', className)}>
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
        style={{ background: `hsl(${meta.tone} / 0.12)`, color: `hsl(${meta.tone})`, boxShadow: `inset 0 0 0 1px hsl(${meta.tone} / 0.22)` }}
      >
        <Icon className="h-3 w-3" />
        {meta.short}
      </span>
      {(availability.note || back) && (
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">{[availability.note, back].filter(Boolean).join(' · ')}</span>
      )}
      <span className="shrink-0 text-[10px] text-muted-foreground/70">{timeAgo(availability.updatedAt)}</span>
    </span>
  );
};

/** The picker in the top bar's avatar menu: four large choices, an optional note and a return date. */
export const AvailabilityPicker: React.FC<{ onDone?: () => void }> = ({ onDone }) => {
  const { user } = useAuth();
  const { byUser } = useAvailability();
  const mine = user ? byUser.get(user.id) : undefined;
  const save = useSetMyAvailability();
  const [status, setStatus] = useState<AvailabilityStatus | null>(mine?.status ?? null);
  const [note, setNote] = useState(mine?.note ?? '');
  const [backOn, setBackOn] = useState(mine?.backOn ?? '');
  const error = validateNote(note);

  const submit = () => {
    if (!status || error) return;
    save.mutate({ status, note, backOn: status === 'ON_LEAVE' ? backOn || null : null }, { onSuccess: () => onDone?.() });
  };

  return (
    <div className="w-[19rem] space-y-3 p-1" aria-label="Set your status">
      <div>
        <p className="text-sm font-semibold">Your status</p>
        <p className="text-xs text-muted-foreground">Let the team see if you can take new work.</p>
      </div>
      <div role="radiogroup" aria-label="Status" className="grid grid-cols-2 gap-2">
        {AVAILABILITY_STATUSES.map((s) => {
          const meta = AVAILABILITY_META[s];
          const Icon = AVAILABILITY_ICONS[s];
          const on = status === s;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setStatus(s)}
              className={cn('press relative flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring', on ? 'border-transparent' : 'border-border hover:bg-muted/60')}
              style={on ? { background: `hsl(${meta.tone} / 0.12)`, boxShadow: `inset 0 0 0 1.5px hsl(${meta.tone})` } : undefined}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `hsl(${meta.tone} / 0.16)`, color: `hsl(${meta.tone})` }}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-xs font-semibold leading-tight">{meta.short}</span>
              <span className="text-[10.5px] leading-tight text-muted-foreground">{meta.hint}</span>
              {on && <Check aria-hidden className="absolute right-2 top-2 h-3.5 w-3.5" style={{ color: `hsl(${meta.tone})` }} />}
            </button>
          );
        })}
      </div>
      <div className="space-y-1">
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX + 10} placeholder="What are you on? (optional)" aria-label="Status note" className="h-9 text-sm" />
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
      {status === 'ON_LEAVE' && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" /> Back on
          <Input type="date" value={backOn} onChange={(e) => setBackOn(e.target.value)} aria-label="Back on" className="h-8 w-auto text-xs" />
        </label>
      )}
      <div className="flex items-center justify-between gap-2">
        {mine ? (
          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => save.mutate(null, { onSuccess: () => onDone?.() })} disabled={save.isPending}>
            Clear status
          </Button>
        ) : (
          <span />
        )}
        <Button type="button" size="sm" className="h-8 rounded-full px-4 text-xs" onClick={submit} disabled={!status || !!error || save.isPending}>
          {save.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          Save status
        </Button>
      </div>
    </div>
  );
};

/** The top bar control: a pill with my status that opens the picker. */
export const MyStatusButton: React.FC = () => {
  const { user } = useAuth();
  const { byUser } = useAvailability();
  const [open, setOpen] = useState(false);
  const mine = user ? byUser.get(user.id) : undefined;
  const meta = mine ? AVAILABILITY_META[mine.status] : undefined;
  const Icon = mine ? AVAILABILITY_ICONS[mine.status] : Zap;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={meta ? `Your status: ${meta.label}. Change status` : 'Set your status'}
          className="press hidden h-8 items-center gap-1.5 rounded-full border border-border/70 bg-card/70 px-2.5 text-xs font-medium hover:bg-muted sm:inline-flex"
          style={meta ? { color: `hsl(${meta.tone})`, borderColor: `hsl(${meta.tone} / 0.35)`, background: `hsl(${meta.tone} / 0.08)` } : undefined}
        >
          <span className="relative flex h-2 w-2">
            {mine?.status === 'AVAILABLE' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: `hsl(${meta?.tone})` }} />}
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: `hsl(${meta?.tone ?? NO_STATUS_TONE})` }} />
          </span>
          <Icon className="h-3.5 w-3.5" />
          <span className={cn(!meta && 'text-muted-foreground')}>{meta ? meta.short : 'Set status'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-auto p-3">
        <AvailabilityPicker onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
};

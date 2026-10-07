import React, { useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { dateToIso, daysFromNowIso, dueState, formatDayLong, isoToDate } from '@/lib/tasks';

interface DatePickerProps {
  id?: string;
  /** Accessible name and tooltip, e.g. "Internal QC due". */
  label: string;
  /** Stored instant (ISO) or null when not set. */
  value: string | null;
  onChange: (iso: string | null) => void;
  disabled?: boolean;
  /** A finished task is never shown as overdue. */
  finished?: boolean;
  className?: string;
}

const TONE: Record<string, string> = {
  overdue: 'font-semibold text-destructive',
  today: 'font-semibold',
  soon: 'font-medium',
  later: '',
};

/**
 * A deadline as a button that opens a calendar, with the shortcuts people actually use (today,
 * tomorrow, next week) and a way to clear it. Overdue dates are tinted. Picking a day saves it
 * straight away; the stored value is that day at local noon (see dateToIso).
 */
const DatePicker: React.FC<DatePickerProps> = ({ id, label, value, onChange, disabled, finished = false, className }) => {
  const [open, setOpen] = useState(false);
  const selected = isoToDate(value);
  const state = finished ? 'later' : dueState(value) ?? 'later';

  const commit = (iso: string | null) => {
    setOpen(false);
    if (iso !== value) onChange(iso);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label={value ? `${label}: ${formatDayLong(value)}` : `${label}: not set`}
          title={label}
          className={cn(
            'flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-transparent px-2 text-left text-sm outline-none transition-colors',
            'hover:bg-muted data-[state=open]:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
            className
          )}
        >
          <CalendarDays aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {value ? (
            <span className={cn('truncate tabular-nums', TONE[state])}>
              {formatDayLong(value)}
              {state === 'overdue' && <span className="ml-1.5 text-[11px] font-medium">overdue</span>}
            </span>
          ) : (
            <span className="text-muted-foreground">Set date</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? new Date()}
          onSelect={(day) => day && commit(dateToIso(day))}
          initialFocus
        />
        <div className="flex flex-wrap items-center gap-1 border-t border-border/70 p-2">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => commit(daysFromNowIso(0))}>
            Today
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => commit(daysFromNowIso(1))}>
            Tomorrow
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => commit(daysFromNowIso(7))}>
            Next week
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-7 px-2 text-xs text-muted-foreground"
              onClick={() => commit(null)}
            >
              <X className="mr-1 h-3 w-3" />
              Clear
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default DatePicker;

/** The same date, as plain text, for people who may not change it. */
export const DateValue: React.FC<{ label: string; value: string | null; finished?: boolean }> = ({ label, value, finished = false }) => {
  if (!value) return <span className="flex h-8 items-center px-2 text-sm text-muted-foreground">Not set</span>;
  const state = finished ? 'later' : dueState(value) ?? 'later';
  return (
    <span className={cn('flex h-8 items-center gap-2 px-2 text-sm tabular-nums', TONE[state])}>
      <span className="sr-only">{label}: </span>
      {formatDayLong(value)}
      {state === 'overdue' && <span className="text-[11px] font-medium">overdue</span>}
    </span>
  );
};

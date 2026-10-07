import React from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MONTH_SHORT, creditsLabel, monthLabel } from '@/lib/production';

interface MonthBarsProps {
  year: number;
  counts: readonly number[];
  selected: number | null;
  /** Months after this one (in the current year) are in the future and cannot hold anything yet. */
  lastMonth?: number;
  onSelect: (month: number) => void;
}

/**
 * Twelve months as a bar chart that is also the month picker. Hovering or focusing a bar says exactly
 * what it counts ("October 2026: 24 videos first submitted for QC"); selecting one lists those videos.
 */
const MonthBars: React.FC<MonthBarsProps> = ({ year, counts, selected, lastMonth = 12, onSelect }) => {
  const max = Math.max(1, ...counts);
  return (
    <ol aria-label={`First QC submissions per month, ${year}`} className="grid grid-cols-12 gap-1 sm:gap-2">
      {counts.map((n, i) => {
        const month = i + 1;
        const future = month > lastMonth;
        const label = `${monthLabel(year, month)}: ${creditsLabel(n)}`;
        const on = selected === month;
        return (
          <li key={month} className="min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={on}
                  disabled={future}
                  onClick={() => onSelect(month)}
                  className={cn(
                    'group flex h-40 w-full flex-col items-center justify-end gap-1 rounded-lg px-0.5 pb-1 pt-2 outline-none transition-colors',
                    'focus-visible:ring-2 focus-visible:ring-ring enabled:hover:bg-muted/70 disabled:cursor-default disabled:opacity-40',
                    on && 'bg-brand-subtle/70'
                  )}
                >
                  <span className={cn('text-[11px] font-semibold tabular-nums', n === 0 ? 'text-muted-foreground/60' : 'text-foreground')}>{n}</span>
                  <span
                    aria-hidden
                    className={cn('w-full max-w-[28px] rounded-t-md transition-[height,background-color]', on ? 'bg-primary' : n ? 'bg-primary/55 group-hover:bg-primary/80' : 'bg-border')}
                    style={{ height: n === 0 ? 3 : `${Math.max(8, Math.round((n / max) * 96))}px` }}
                  />
                  <span className={cn('text-[10px] font-medium uppercase tracking-wide', on ? 'text-foreground' : 'text-muted-foreground')}>{MONTH_SHORT[i]}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-center">
                <div className="text-xs font-semibold">{monthLabel(year, month)}</div>
                <div className="text-xs">{creditsLabel(n)}</div>
              </TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ol>
  );
};

export default MonthBars;

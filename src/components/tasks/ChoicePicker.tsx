import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

export interface Choice<T extends string> {
  value: T;
  label: string;
  /** What the option looks like (pill, flag...). Defaults to the label. */
  render?: React.ReactNode;
  disabled?: boolean;
}

interface ChoicePickerProps<T extends string> {
  /** Accessible name of the control, e.g. "Status". */
  label: string;
  value: T;
  choices: ReadonlyArray<Choice<T>>;
  onChange: (value: T) => void;
  /** The closed control (the current value). It becomes the popover trigger. */
  trigger: React.ReactNode;
  /** Show a search box (worth it once a list has more than a handful of options). */
  searchable?: boolean;
  heading?: string;
  disabled?: boolean;
  className?: string;
  align?: 'start' | 'center' | 'end';
}

/**
 * One small, keyboard-friendly picker for single choices (status, priority): opens on click,
 * arrow keys + Enter choose, Escape closes, typing filters when searchable. Disabled options are
 * shown but cannot be chosen, so a person sees the whole workflow and what their role allows.
 */
function ChoicePicker<T extends string>({
  label,
  value,
  choices,
  onChange,
  trigger,
  searchable = false,
  heading,
  disabled,
  className,
  align = 'start',
}: ChoicePickerProps<T>): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = choices.filter((c) => !needle || c.label.toLowerCase().includes(needle));

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
          // a click on a control inside a clickable row must not open the row
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'inline-flex min-w-0 items-center rounded-md text-left outline-none transition-colors',
            'focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default',
            className
          )}
        >
          {trigger}
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-56 p-0" onClick={(e) => e.stopPropagation()}>
        <Command shouldFilter={false}>
          {searchable && <CommandInput value={query} onValueChange={setQuery} placeholder="Search..." aria-label={`Search ${label.toLowerCase()}`} />}
          <CommandList>
            {shown.length === 0 && <div className="px-3 py-4 text-center text-xs text-muted-foreground">No match.</div>}
            <CommandGroup heading={heading}>
              {shown.map((c) => (
                <CommandItem
                  key={c.value}
                  value={c.value}
                  disabled={c.disabled}
                  onSelect={() => {
                    setOpen(false);
                    if (c.value !== value) onChange(c.value);
                  }}
                  className="gap-2"
                >
                  <span className="min-w-0 flex-1">{c.render ?? c.label}</span>
                  {c.value === value && <Check aria-hidden className="h-3.5 w-3.5 shrink-0" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default ChoicePicker;

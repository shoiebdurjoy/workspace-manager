import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { COLOR_PALETTE } from '@/lib/hierarchy';
import { SPACE_ICON_KEYS, iconFor } from './space-icons';

export const ColorPicker: React.FC<{ value: string; onChange: (color: string) => void; label?: string }> = ({
  value,
  onChange,
  label = 'Color',
}) => (
  <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
    {COLOR_PALETTE.map((color) => (
      <button
        key={color}
        type="button"
        role="radio"
        aria-checked={value === color}
        aria-label={color}
        onClick={() => onChange(color)}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          value === color && 'ring-2 ring-foreground ring-offset-2'
        )}
        style={{ backgroundColor: color }}
      >
        {value === color && <Check className="h-3 w-3 text-white" />}
      </button>
    ))}
  </div>
);

export const IconPicker: React.FC<{ value: string; onChange: (icon: string) => void; color: string }> = ({
  value,
  onChange,
  color,
}) => (
  <div role="radiogroup" aria-label="Icon" className="grid grid-cols-9 gap-1.5">
    {SPACE_ICON_KEYS.map((key) => {
      const Icon = iconFor(key);
      const selected = value === key;
      return (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={selected}
          aria-label={key}
          onClick={() => onChange(key)}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            selected && 'border-transparent text-white'
          )}
          style={selected ? { backgroundColor: color } : undefined}
        >
          <Icon className="h-4 w-4" />
        </button>
      );
    })}
  </div>
);

import React from 'react';
import { ArrowDown, ArrowUp, LayoutGrid } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';

/**
 * "Customize Home": show / hide and re-order the Home cards. Saved per person (it changes only what they see).
 */
const CustomizeHome: React.FC<{
  blocks: { id: string; label: string }[];
  hidden: string[];
  onChange: (order: string[], hidden: string[]) => void;
}> = ({ blocks, hidden, onChange }) => {
  const ids = blocks.map((b) => b.id);
  const move = (i: number, by: -1 | 1) => {
    const next = [...ids];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x);
    onChange(next, hidden);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Customize Home" className="press inline-flex h-7 items-center gap-1.5 rounded-full bg-white/15 px-2.5 text-[11px] font-medium text-white backdrop-blur hover:bg-white/25">
          <LayoutGrid aria-hidden className="h-3.5 w-3.5" /> Customize
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <p className="px-2 pb-1.5 text-xs font-semibold">Your Home</p>
        <p className="px-2 pb-2 text-[11px] text-muted-foreground">Only you see these changes.</p>
        <ul className="space-y-0.5">
          {blocks.map((b, i) => {
            const on = !hidden.includes(b.id);
            return (
              <li key={b.id} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted">
                <span className="min-w-0 flex-1 truncate text-sm">{b.label}</span>
                <button type="button" aria-label={`Move ${b.label} up`} disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label={`Move ${b.label} down`} disabled={i === blocks.length - 1} onClick={() => move(i, 1)} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <Switch checked={on} aria-label={`${b.label} ${on ? 'shown' : 'hidden'}`} onCheckedChange={(v) => onChange(ids, v ? hidden.filter((x) => x !== b.id) : [...hidden, b.id])} />
              </li>
            );
          })}
        </ul>
        <button type="button" onClick={() => onChange([], [])} className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
          Reset to the default layout
        </button>
      </PopoverContent>
    </Popover>
  );
};

export default CustomizeHome;

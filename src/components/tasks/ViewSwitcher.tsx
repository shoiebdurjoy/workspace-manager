import React from 'react';
import { Columns3, ListTodo, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VIEW_MODES, type ViewMode } from '@/lib/task-views';

const ICONS: Record<ViewMode, React.ReactNode> = {
  list: <ListTodo aria-hidden className="h-3.5 w-3.5" />,
  board: <Columns3 aria-hidden className="h-3.5 w-3.5" />,
  table: <Table2 aria-hidden className="h-3.5 w-3.5" />,
};

/**
 * List / Board / Table: three layouts of the same tasks. A tablist, so arrow keys move between them;
 * the choice is kept in the URL by the caller.
 */
const ViewSwitcher: React.FC<{ mode: ViewMode; onChange: (mode: ViewMode) => void }> = ({ mode, onChange }) => {
  const onKey = (e: React.KeyboardEvent) => {
    const i = VIEW_MODES.findIndex((m) => m.value === mode);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = VIEW_MODES[(i + step + VIEW_MODES.length) % VIEW_MODES.length].value;
    onChange(next);
    // keep focus on the newly selected tab
    requestAnimationFrame(() => document.getElementById(`view-tab-${next}`)?.focus());
  };
  return (
    <div role="tablist" aria-label="View" onKeyDown={onKey} className="inline-flex h-8 items-center rounded-lg border border-border bg-muted/50 p-0.5">
      {VIEW_MODES.map((m) => {
        const on = m.value === mode;
        return (
          <button
            key={m.value}
            id={`view-tab-${m.value}`}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(m.value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              on ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {ICONS[m.value]}
            {m.label}
          </button>
        );
      })}
    </div>
  );
};

export default ViewSwitcher;

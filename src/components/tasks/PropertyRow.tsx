import React from 'react';
import { cn } from '@/lib/utils';

/**
 * One label + value line in the detail sheet. The label sits left on a fixed width so values line
 * up and a long list of properties scans like a table, not a form.
 */
const PropertyRow: React.FC<{
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}> = ({ label, htmlFor, children, className }) => (
  <div className={cn('grid min-h-8 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-2', className)}>
    <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
      {label}
    </label>
    <div className="min-w-0">{children}</div>
  </div>
);

export default PropertyRow;

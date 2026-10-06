import React from 'react';
import { cn } from '@/lib/utils';
import { ROLE_LABELS } from '@/lib/permissions';
import type { TbbRole } from '@/types/database';

const ROLE_STYLES: Record<TbbRole, string> = {
  OWNER: 'bg-brand-subtle text-brand-subtle-foreground',
  ADMIN: 'bg-foreground/10 text-foreground',
  PRODUCTION_MANAGER: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  QC_SPECIALIST: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  EDITOR: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  CLIENT_VIEWER: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const RoleBadge: React.FC<{ role: TbbRole; className?: string }> = ({ role, className }) => (
  <span
    className={cn(
      'inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
      ROLE_STYLES[role],
      className
    )}
  >
    {ROLE_LABELS[role]}
  </span>
);

export default RoleBadge;

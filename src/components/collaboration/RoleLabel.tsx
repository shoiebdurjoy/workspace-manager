import React from 'react';
import { ROLE_LABELS } from '@/lib/permissions';
import type { TbbRole } from '@/types/database';

/** A role as quiet small text (the full coloured badge is too loud inside lists of people). */
export const RoleLabel: React.FC<{ role: TbbRole }> = ({ role }) => (
  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{ROLE_LABELS[role]}</span>
);

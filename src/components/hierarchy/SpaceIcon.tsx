import React from 'react';
import { cn } from '@/lib/utils';
import { iconFor } from './space-icons';

interface SpaceIconProps {
  icon?: string | null;
  color: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

const BOX = { xs: 'h-4 w-4', sm: 'h-5 w-5', md: 'h-8 w-8' } as const;
const GLYPH = { xs: 'h-2.5 w-2.5', sm: 'h-3 w-3', md: 'h-4 w-4' } as const;

/** A Space's colored tile with its icon. Color is validated hex (database CHECK + client). */
const SpaceIcon: React.FC<SpaceIconProps> = ({ icon, color, size = 'sm', className }) => {
  const Icon = iconFor(icon);
  return (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 items-center justify-center rounded text-white', BOX[size], className)}
      style={{ backgroundColor: color }}
    >
      <Icon className={GLYPH[size]} />
    </span>
  );
};

export default SpaceIcon;

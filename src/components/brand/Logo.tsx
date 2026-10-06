import React from 'react';
import { cn } from '@/lib/utils';
import { BRAND, BRAND_ASSETS, LOCKUP_SIZE, MARK_SIZE } from '@/lib/brand';

type Size = 'sm' | 'md' | 'lg';

/** Rendered widths; heights follow the artwork's own aspect ratio (never stretched). */
const MARK_WIDTH: Record<Size, number> = { sm: 30, md: 40, lg: 56 };
const LOCKUP_WIDTH: Record<Size, number> = { sm: 104, md: 148, lg: 196 };

interface ArtworkProps {
  size?: Size;
  className?: string;
}

/** The red-bars mark. Decorative by default: the product name is always next to it as text. */
export const BrandMark: React.FC<ArtworkProps & { label?: string }> = ({ size = 'sm', className, label }) => {
  const width = MARK_WIDTH[size];
  const height = Math.round((width * MARK_SIZE.height) / MARK_SIZE.width);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center dark:rounded-md dark:bg-white dark:p-1',
        className
      )}
    >
      <img
        src={BRAND_ASSETS.mark}
        width={width}
        height={height}
        alt={label ?? ''}
        aria-hidden={label ? undefined : true}
        decoding="async"
        draggable={false}
        style={{ width, height }}
      />
    </span>
  );
};

/** The complete TBB logo (mark + "Think Big." wordmark) for auth and onboarding screens. */
export const BrandLockup: React.FC<ArtworkProps> = ({ size = 'md', className }) => {
  const width = LOCKUP_WIDTH[size];
  const height = Math.round((width * LOCKUP_SIZE.height) / LOCKUP_SIZE.width);
  return (
    <span className={cn('brand-plate inline-flex', className)}>
      <img
        src={BRAND_ASSETS.lockup}
        width={width}
        height={height}
        alt={BRAND.company}
        decoding="async"
        draggable={false}
        style={{ width, height }}
      />
    </span>
  );
};

interface LogoProps {
  size?: Size;
  /** false in the collapsed sidebar: the mark alone still identifies the product. */
  showText?: boolean;
  className?: string;
}

/**
 * Compact product signature used in the sidebar: the real mark plus the product name set in the
 * interface font. (The full "Think Big." wordmark is shown by BrandLockup where there is room;
 * it is never re-typeset.)
 */
const Logo: React.FC<LogoProps> = ({ size = 'sm', showText = true, className }) => (
  <span className={cn('flex select-none items-center gap-2.5', className)}>
    <BrandMark size={size} />
    {showText && (
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[13px] font-semibold tracking-tight text-foreground">TBB</span>
        <span className="block truncate text-[11px] font-medium text-muted-foreground">Workspace</span>
      </span>
    )}
  </span>
);

export default Logo;

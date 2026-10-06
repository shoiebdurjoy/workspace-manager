/**
 * TBB brand constants. The artwork lives in /public/brand and is derived from the original
 * logo (tbb-logo-original.jpg) by exact pixel operations only (white -> transparency, trim, crop,
 * resize); nothing is redrawn. Components never hard-code these values.
 */

export const BRAND = {
  company: 'Think Big Brand',
  product: 'TBB Workspace',
  /** The coral of the logo's bars (measured from the artwork). Decorative / content default. */
  accent: '#F25B4A',
} as const;

export const BRAND_ASSETS = {
  /** Mark + wordmark, transparent, trimmed. For light surfaces (white plate in dark mode). */
  lockup: '/brand/tbb-lockup.png',
  /** The red-bars mark alone, transparent, trimmed. For compact placements. */
  mark: '/brand/tbb-mark.png',
  /** The untouched original, kept as the source of truth. */
  original: '/brand/tbb-logo-original.jpg',
} as const;

/** Intrinsic pixel sizes of the derived artwork, so images keep their ratio and never shift layout. */
export const LOCKUP_SIZE = { width: 226, height: 170 } as const;
export const MARK_SIZE = { width: 140, height: 113 } as const;

/** Colour given to a new Space / List when the person does not choose one. */
export const DEFAULT_CONTENT_COLOR: string = BRAND.accent;

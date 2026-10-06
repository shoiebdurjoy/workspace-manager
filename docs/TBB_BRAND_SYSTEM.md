# TBB Brand System

Source of truth: `logo.jpg` (project root, untouched). The interface is a quiet, warm-neutral
canvas; the logo's coral is the single accent.

## Logo artwork (`public/brand/`)
Derived from the original by exact pixel operations only (white to transparency, trim, crop,
Lanczos resize). Nothing is redrawn or recoloured. `tbb-logo-original.jpg` is a byte-identical copy.

| File | Use |
| --- | --- |
| `tbb-lockup.png` | Mark + "Think Big." wordmark: sign-in, register, reset, onboarding |
| `tbb-mark.png` | Red bars alone: sidebar header, collapsed sidebar, mobile header |
| `icon-16/32/192.png`, `favicon.ico`, `apple-touch-icon.png` | Favicon and touch icon |

In dark mode the artwork sits on a white plate (`.brand-plate`, or the mark's `dark:` classes)
because the logo's coral is semi-transparent over white and turns muddy on dark surfaces.
Components import paths and sizes from `src/lib/brand.ts`; never hard-code them.

## Colour tokens (`src/index.css`, mapped in `tailwind.config.ts`)
| Role | Token | Light | Notes |
| --- | --- | --- | --- |
| Primary button | `primary`, `primary-hover`, `primary-active` | coral 48% / 42% / 35% L | White label, AA |
| Link / brand text | `brand`, `brand-hover` | coral 42% / 34% L | AA on page and card |
| Subtle brand surface | `brand-subtle`, `brand-subtle-foreground` | very light coral | Owner badge, highlights |
| Decorative accent | `brand-accent` | logo coral | Active-nav indicator only |
| Focus ring | `ring` | lighter coral | 3:1 against the page |
| Destructive | `destructive` | deeper crimson | Distinct from the brand coral |
| Neutrals | `background`, `card`, `muted`, `border`, `input`, `sidebar-*` | warm stone | |

Selected navigation = neutral fill plus a 2px coral indicator (`.nav-active`). Coral is never a
large background. Status and priority colours are functional and independent of the brand.

Space, list and pod colours are content-identification colours (`COLOR_PALETTE` in
`src/lib/hierarchy.ts`); the default is the brand coral. The database column defaults still say
`#7B68EE`; the app always sends an explicit colour, and no migration was changed.

## Guardrails
`src/test/brand-tokens.test.ts` parses the tokens from `index.css` and fails if a text pair drops
below WCAG AA (4.5:1) in either theme, if purple utility classes return (outside the functional
"in edit" status badge), or if the brand hex is repeated outside `src/lib/brand.ts`.

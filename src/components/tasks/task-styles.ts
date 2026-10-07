/**
 * Shared class names for the task detail sheet. "Ghost" controls look like plain text until they are
 * hovered or focused, so the panel reads like a document and not like a form full of boxes; only
 * things a person can actually change get them.
 */
export const GHOST_SELECT_TRIGGER =
  'h-8 w-full justify-between gap-2 border-transparent bg-transparent px-2 text-sm shadow-none hover:bg-muted data-[state=open]:bg-muted [&>span]:flex [&>span]:min-w-0 [&>span]:items-center';

/** The static look of a value that cannot be edited: same footprint as a ghost control, no affordance. */
export const STATIC_VALUE = 'flex h-8 items-center gap-2 px-2 text-sm';

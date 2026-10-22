import React, { useState } from 'react';
import { Check, Plus, Tag as TagIcon, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { validateTagName, type Tag } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { useTagMutations, useTags, useTaskTagMap } from '@/hooks/use-tags';
import { canEditFieldValue } from '@/lib/custom-fields';
import { cn } from '@/lib/utils';

export const TAG_COLORS = ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6', '#0EA5E9', '#3B82F6', '#EC4899', '#A855F7', '#64748B'];
const MANAGERS = ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER'];

/** A small coloured tag pill. */
export const TagChip: React.FC<{ tag: Tag; className?: string }> = ({ tag, className }) => (
  <span
    className={cn('inline-flex max-w-[10rem] items-center gap-1 truncate rounded-full px-2 py-0.5 text-[10.5px] font-medium leading-4', className)}
    style={{ background: `${tag.color}22`, color: tag.color, boxShadow: `inset 0 0 0 1px ${tag.color}40` }}
    title={tag.name}
  >
    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tag.color }} />
    <span className="truncate">{tag.name}</span>
  </span>
);

/** The tags on one task, read-only (list rows). */
export const TaskTagChips: React.FC<{ taskId: string; max?: number }> = ({ taskId, max = 3 }) => {
  const tags = useTags().data ?? [];
  const ids = useTaskTagMap().data?.get(taskId) ?? [];
  const mine = tags.filter((t) => ids.includes(t.id));
  if (mine.length === 0) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {mine.slice(0, max).map((t) => (
        <TagChip key={t.id} tag={t} />
      ))}
      {mine.length > max && <span className="text-[10.5px] text-muted-foreground">+{mine.length - max}</span>}
    </span>
  );
};

/** The task detail's Tags row: chips plus a picker to add / remove, and (for managers) create a new tag. */
export const TaskTagsField: React.FC<{ taskId: string; isAssignedEditor: boolean }> = ({ taskId, isAssignedEditor }) => {
  const { role } = useAuth();
  const tags = useTags().data ?? [];
  const ids = useTaskTagMap().data?.get(taskId) ?? [];
  const m = useTagMutations();
  const [query, setQuery] = useState('');
  const editable = canEditFieldValue(role, isAssignedEditor);
  const canCreate = !!role && MANAGERS.includes(role);
  const mine = tags.filter((t) => ids.includes(t.id));
  const needle = query.trim().toLowerCase();
  const shown = tags.filter((t) => !needle || t.name.toLowerCase().includes(needle));
  const exact = tags.some((t) => t.name.toLowerCase() === needle);

  const create = async () => {
    if (validateTagName(query, tags.map((t) => t.name))) return;
    const tag = await m.create.mutateAsync({ name: query, color: TAG_COLORS[tags.length % TAG_COLORS.length], position: tags.length });
    m.toggle.mutate({ taskId, tagId: tag.id, on: true });
    setQuery('');
  };

  const chips = mine.length > 0 ? mine.map((t) => <TagChip key={t.id} tag={t} />) : <span className="text-sm text-muted-foreground/70">No tags</span>;
  if (!editable) return <div className="flex min-h-8 flex-wrap items-center gap-1 px-2">{chips}</div>;

  return (
    <Popover onOpenChange={(o) => !o && setQuery('')}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Tags" className="flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md px-2 py-1 text-left hover:bg-muted">
          {chips}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={canCreate ? 'Search or create a tag' : 'Search tags'} aria-label="Search tags" className="mb-1.5 h-8 text-sm" autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canCreate && needle && !exact) {
              e.preventDefault();
              void create();
            }
          }}
        />
        <ul className="max-h-60 space-y-0.5 overflow-y-auto">
          {shown.map((t) => {
            const on = ids.includes(t.id);
            return (
              <li key={t.id}>
                <button type="button" aria-pressed={on} onClick={() => m.toggle.mutate({ taskId, tagId: t.id, on: !on })} className="press flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted">
                  <TagChip tag={t} />
                  {on && <Check aria-hidden className="h-3.5 w-3.5 text-primary" />}
                </button>
              </li>
            );
          })}
          {shown.length === 0 && !canCreate && <li className="px-2 py-1.5 text-xs text-muted-foreground">No tags yet. A manager can create them.</li>}
        </ul>
        {canCreate && needle && !exact && (
          <button type="button" onClick={() => void create()} disabled={m.create.isPending} className="press mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-primary hover:bg-muted">
            <Plus aria-hidden className="h-3.5 w-3.5" /> Create "{query.trim()}"
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
};

/** Settings > Customize workspace > Tags: rename, recolour and delete; new tags are also created from any video. */
export const TagsEditor: React.FC = () => {
  const tags = useTags();
  const m = useTagMutations();
  const [name, setName] = useState('');
  const list = tags.data ?? [];
  const error = name.trim() ? validateTagName(name, list.map((t) => t.name)) : null;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Tags mark videos across every client (Reshoot, Urgent client, Needs music...). Deleting a tag removes it from every video.</p>
      {list.length === 0 && !tags.isLoading && <p className="text-sm text-muted-foreground">No tags yet.</p>}
      <ul className="divide-y divide-border/60 overflow-hidden rounded-card border border-border/70">
        {list.map((t) => (
          <li key={t.id} className="flex items-center gap-2 bg-background/40 px-3 py-2">
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" aria-label={`Colour of ${t.name}`} className="press h-5 w-5 shrink-0 rounded-full shadow ring-2 ring-background" style={{ background: t.color }} />
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2">
                <div className="grid grid-cols-5 gap-1.5">
                  {TAG_COLORS.map((c) => (
                    <button key={c} type="button" aria-label={c} onClick={() => m.update.mutate({ id: t.id, patch: { color: c } })} className={cn('press h-6 w-6 rounded-full', c.toLowerCase() === t.color.toLowerCase() && 'ring-2 ring-ring ring-offset-2 ring-offset-background')} style={{ background: c }} />
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Input
              key={`${t.id}-${t.name}`}
              defaultValue={t.name}
              aria-label={`Name of tag ${t.name}`}
              maxLength={40}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== t.name && m.update.mutate({ id: t.id, patch: { name: e.target.value } })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="h-8 flex-1"
            />
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label={`Delete tag ${t.name}`}
              onClick={() => window.confirm(`Delete the tag "${t.name}"? It is removed from every video.`) && m.remove.mutate(t.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || error) return;
          m.create.mutate({ name, color: TAG_COLORS[list.length % TAG_COLORS.length], position: list.length }, { onSuccess: () => setName('') });
        }}
      >
        <TagIcon aria-hidden className="h-4 w-4 text-muted-foreground" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag, e.g. Reshoot" aria-label="New tag name" maxLength={40} className="h-9 flex-1" aria-invalid={!!error} />
        <Button type="submit" size="sm" disabled={!name.trim() || !!error || m.create.isPending}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add tag
        </Button>
      </form>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
};

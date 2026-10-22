import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, BookmarkPlus, Check, ChevronDown, Star, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createSavedView, deleteSavedView, listSavedViews, pickDefaultView, sameQuery, updateSavedView, type SavedView, type ViewLayout } from '@/database';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

const MANAGERS = ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER'];

/**
 * The "Views" menu beside List / Board / Table: save the current filters, search, grouping, sort and layout under
 * a name, privately or (managers) for the whole team, and pick a default that opens when someone arrives without
 * filters. Applying a view only changes the URL and the layout; nothing about the tasks changes.
 */
const SavedViewsMenu: React.FC<{ scope: string; mode: ViewLayout }> = ({ scope, mode }) => {
  const { workspace, role, user } = useAuth();
  const ws = workspace?.id ?? '';
  const me = user?.id ?? null;
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const key = ['workspace', ws, 'saved-views', scope];
  const views = useQuery({ queryKey: key, queryFn: () => listSavedViews(ws, scope), enabled: !!ws && role !== 'CLIENT_VIEWER', staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [share, setShare] = useState(false);
  const [asDefault, setAsDefault] = useState(false);
  const isManager = !!role && MANAGERS.includes(role);
  // the layout travels separately (mode); the query is everything else in the URL
  const withoutLayout = new URLSearchParams(params);
  withoutLayout.delete('view');
  const current = withoutLayout.toString();
  const list = views.data ?? [];
  const active = list.find((v) => sameQuery(v.query, current) && v.mode === mode);
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : 'That did not save.');
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const save = useMutation({
    mutationFn: () => createSavedView(ws, { scope, name, query: current, mode, isShared: share, isDefault: asDefault }),
    onSuccess: () => {
      void refresh();
      toast.success(`View "${name.trim()}" saved`);
      setName('');
      setShare(false);
      setAsDefault(false);
    },
    onError: fail,
  });
  const patch = useMutation({ mutationFn: ({ id, p }: { id: string; p: Partial<SavedView> }) => updateSavedView(id, p), onSuccess: refresh, onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => deleteSavedView(id), onSuccess: refresh, onError: fail });

  const apply = (v: SavedView) => {
    const next = new URLSearchParams(v.query);
    next.set('view', v.mode);
    setParams(next, { replace: true });
    setOpen(false);
  };

  // arriving without filters opens the default view once per place
  const appliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!views.isSuccess || appliedFor.current === scope) return;
    appliedFor.current = scope;
    if (current) return;
    const d = pickDefaultView(list, me);
    if (d) apply(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views.isSuccess, scope]);

  if (role === 'CLIENT_VIEWER') return null;
  const canChange = (v: SavedView) => (v.isShared ? isManager : v.ownerId === me);
  const groups: [string, SavedView[]][] = [
    ['Team views', list.filter((v) => v.isShared)],
    ['My views', list.filter((v) => !v.isShared && v.ownerId === me)],
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Saved views"
          className="press inline-flex h-8 max-w-[12rem] items-center gap-1.5 rounded-control border border-border/70 bg-background/60 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Bookmark aria-hidden className={cn('h-3.5 w-3.5', active && 'fill-primary text-primary')} />
          <span className="truncate">{active ? active.name : 'Views'}</span>
          <ChevronDown aria-hidden className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        {list.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No saved views here yet. Set the filters, grouping and layout you like, then save them below.</p>}
        {groups.map(([label, items]) =>
          items.length === 0 ? null : (
            <div key={label} className="mb-1.5">
              <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
              <ul>
                {items.map((v) => (
                  <li key={v.id} className="group flex items-center gap-1 rounded-md hover:bg-muted">
                    <button type="button" onClick={() => apply(v)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm">
                      {active?.id === v.id ? <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" /> : v.isShared ? <Users aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <Bookmark aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      <span className="truncate">{v.name}</span>
                      <span className="ml-auto shrink-0 text-[10px] uppercase text-muted-foreground">{v.mode}</span>
                    </button>
                    {canChange(v) && (
                      <>
                        <button type="button" aria-label={`${v.isDefault ? 'Stop opening' : 'Open'} ${v.name} by default`} aria-pressed={v.isDefault} onClick={() => patch.mutate({ id: v.id, p: { isDefault: !v.isDefault } })} className="rounded p-1 text-muted-foreground hover:text-amber-500">
                          <Star aria-hidden className={cn('h-3.5 w-3.5', v.isDefault && 'fill-amber-400 text-amber-400')} />
                        </button>
                        <button type="button" aria-label={`Delete ${v.name}`} onClick={() => window.confirm(`Delete the view "${v.name}"?`) && remove.mutate(v.id)} className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100">
                          <Trash2 aria-hidden className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )
        )}
        <form
          className="mt-1 space-y-2 border-t border-border/60 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save.mutate();
          }}
        >
          <p className="flex items-center gap-1.5 px-1 text-xs font-medium">
            <BookmarkPlus aria-hidden className="h-3.5 w-3.5 text-primary" /> Save what you see now
          </p>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="View name, e.g. Waiting for QC" aria-label="View name" maxLength={60} className="h-8 text-sm" />
          <div className="flex flex-wrap gap-3 px-1 text-xs">
            {isManager && (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" /> Share with team
              </label>
            )}
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={asDefault} onChange={(e) => setAsDefault(e.target.checked)} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" /> Open by default
            </label>
          </div>
          <Button type="submit" size="sm" className="w-full" disabled={!name.trim() || save.isPending}>
            Save view
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
};

export default SavedViewsMenu;

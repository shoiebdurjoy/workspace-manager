import React, { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { NOTE_MAX_LENGTH } from '@/database';
import { validateTaskUrl } from '@/lib/tasks';
import type { Requirement } from '@/lib/workflow';
import type { WorkspaceMember } from '@/types/database';
import PersonPicker from './PersonPicker';
import { TaskStatusPill } from './TaskBadges';

export interface TransitionValues {
  editorId?: string;
  reviewLink?: string;
  finalExportLink?: string;
  note?: string;
}

interface TransitionDialogProps {
  /** "Submit for QC" / "Request revision" / "Move to X". */
  title: string;
  to: string;
  /** What the target stage needs that the task (or tasks) do not have yet. */
  needs: readonly Requirement[];
  /** How many tasks this applies to (bulk); 1 for a single task. */
  count?: number;
  members?: readonly WorkspaceMember[];
  qcId?: string | null;
  /** An Owner / Admin moving outside the normal steps: said plainly, it is recorded as such. */
  override?: boolean;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (values: TransitionValues) => void;
}

/**
 * Asks for exactly what the next stage needs before the move is sent: the editor, the review link of
 * the cut, the final export, or what to change. Nothing else. The database checks the same things.
 */
const TransitionDialog: React.FC<TransitionDialogProps> = ({
  title,
  to,
  needs,
  count = 1,
  members = [],
  qcId = null,
  override = false,
  pending = false,
  onCancel,
  onConfirm,
}) => {
  const id = useId();
  const [values, setValues] = useState<TransitionValues>({});
  const [errors, setErrors] = useState<Partial<Record<Requirement, string>>>({});
  const isRevision = needs.includes('note');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Partial<Record<Requirement, string>> = {};
    if (needs.includes('editor') && !values.editorId) next.editor = 'Choose the editor.';
    for (const [need, value] of [
      ['reviewLink', values.reviewLink],
      ['finalExport', values.finalExportLink],
    ] as const) {
      if (!needs.includes(need)) continue;
      next[need] = !value?.trim() ? 'Paste the link.' : validateTaskUrl(value) ?? undefined;
    }
    if (needs.includes('note')) {
      const note = values.note?.trim() ?? '';
      if (!note) next.note = 'Say what needs to change.';
      else if (note.length > NOTE_MAX_LENGTH) next.note = `Keep it to ${NOTE_MAX_LENGTH} characters.`;
    }
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v)) as typeof next;
    setErrors(clean);
    if (Object.keys(clean).length === 0) onConfirm(values);
  };

  const field = (need: Requirement) => ({
    'aria-invalid': !!errors[need],
    'aria-describedby': errors[need] ? `${id}-${need}-error` : undefined,
  });
  const error = (need: Requirement) =>
    errors[need] ? (
      <p id={`${id}-${need}-error`} role="alert" className="text-xs text-destructive">
        {errors[need]}
      </p>
    ) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onCancel()}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                {count > 1 ? `${count} tasks move to` : 'The task moves to'} <TaskStatusPill status={to} />
                {override && <span className="w-full text-xs">This is outside the normal steps and is recorded as an admin override.</span>}
              </div>
            </DialogDescription>
          </DialogHeader>

          {needs.includes('editor') && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-editor`}>Editor</Label>
              <PersonPicker
                id={`${id}-editor`}
                slot="EDITOR"
                label="Editor"
                value={values.editorId ?? null}
                members={members}
                otherSlotUserId={qcId}
                onChange={(editorId) => setValues((v) => ({ ...v, editorId: editorId ?? undefined }))}
                className="w-full"
              />
              {error('editor')}
            </div>
          )}
          {needs.includes('reviewLink') && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-review`}>Review link of the cut</Label>
              <Input
                id={`${id}-review`}
                type="url"
                inputMode="url"
                placeholder="https://frame.io/..."
                value={values.reviewLink ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, reviewLink: e.target.value }))}
                {...field('reviewLink')}
              />
              {error('reviewLink')}
            </div>
          )}
          {needs.includes('finalExport') && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-export`}>Final export link</Label>
              <Input
                id={`${id}-export`}
                type="url"
                inputMode="url"
                placeholder="https://drive.google.com/..."
                value={values.finalExportLink ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, finalExportLink: e.target.value }))}
                {...field('finalExport')}
              />
              {error('finalExport')}
            </div>
          )}
          {isRevision && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-note`}>What needs to change?</Label>
              <Textarea
                id={`${id}-note`}
                rows={4}
                maxLength={NOTE_MAX_LENGTH}
                placeholder="e.g. Tighten the intro, fix the caption typo at 0:42, swap the music bed."
                value={values.note ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))}
                {...field('note')}
              />
              {error('note')}
              <p className="text-xs text-muted-foreground">The editor sees this note on the task. It counts as a new revision.</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} variant={isRevision ? 'destructive' : 'default'}>
              {pending && <Loader2 aria-hidden className="mr-1.5 h-4 w-4 animate-spin" />}
              {title}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default TransitionDialog;

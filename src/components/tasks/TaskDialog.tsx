import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, FormError } from '@/components/auth/AuthLayout';
import { useCreateTask } from '@/hooks/use-tasks';
import { useWorkspaceMembers } from '@/hooks/use-team';
import {
  ASPECT_RATIOS,
  LINK_FIELDS,
  TASK_PRIORITIES,
  dateInputToIso,
  deadlineWarning,
  validateTaskDescription,
  validateTaskTitle,
  validateTaskUrl,
  type LinkField,
} from '@/lib/tasks';
import type { AspectRatio, Task, TaskPriority } from '@/types/database';
import AssigneeSelect from './AssigneeSelect';

const NO_RATIO = '__none__';

interface TaskDialogProps {
  listId: string;
  listName: string;
  onClose: () => void;
  onCreated: (task: Task) => void;
}

/**
 * The full creation form for a video deliverable. Quick entry (title only) lives in the list
 * itself; this dialog is for when the brief is known: assignments, deadlines and links.
 */
const TaskDialog: React.FC<TaskDialogProps> = ({ listId, listName, onClose, onCreated }) => {
  const create = useCreateTask();
  const { data: members = [] } = useWorkspaceMembers();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [aspectRatio, setAspectRatio] = useState<string>(NO_RATIO);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [qcId, setQcId] = useState<string | null>(null);
  const [due, setDue] = useState('');
  const [client, setClient] = useState('');
  const [links, setLinks] = useState<Record<LinkField, string>>({
    rawFootageLink: '',
    projectFileLink: '',
    reviewLink: '',
    finalExportLink: '',
  });
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const saving = create.isPending;
  const warning = deadlineWarning(dateInputToIso(due), dateInputToIso(client));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string | null> = {
      title: validateTaskTitle(title),
      description: validateTaskDescription(description),
    };
    for (const { key, label } of LINK_FIELDS) {
      const message = validateTaskUrl(links[key]);
      next[key] = message ? `${label}: ${message}` : null;
    }
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    setFormError(null);
    try {
      const task = await create.mutateAsync({
        listId,
        title,
        description,
        priority,
        aspectRatio: aspectRatio === NO_RATIO ? null : (aspectRatio as AspectRatio),
        rawFootageLink: links.rawFootageLink,
        projectFileLink: links.projectFileLink,
        reviewLink: links.reviewLink,
        finalExportLink: links.finalExportLink,
        dueDate: dateInputToIso(due),
        clientDeadline: dateInputToIso(client),
        editorId,
        qcId,
      });
      onCreated(task);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'The task could not be created.');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
            <DialogDescription>A video deliverable in {listName}. Only the title is required.</DialogDescription>
          </DialogHeader>
          <FormError message={formError} />

          <div className="space-y-1.5">
            <Label htmlFor="task-title" className="text-xs">
              Title
            </Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Episode 12 - Founder story (9:16)"
              autoFocus
              aria-invalid={!!errors.title}
              aria-describedby={errors.title ? 'task-title-error' : undefined}
              className="h-9 text-sm"
            />
            <FieldError id="task-title-error" message={errors.title ?? null} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-description" className="text-xs">
              Brief
            </Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What needs to be edited, references, notes for the editor"
              aria-invalid={!!errors.description}
              aria-describedby={errors.description ? 'task-description-error' : undefined}
              className="text-sm"
            />
            <FieldError id="task-description-error" message={errors.description ?? null} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-priority" className="text-xs">
                Priority
              </Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger id="task-priority" aria-label="Priority" className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-ratio" className="text-xs">
                Aspect ratio
              </Label>
              <Select value={aspectRatio} onValueChange={setAspectRatio}>
                <SelectTrigger id="task-ratio" aria-label="Aspect ratio" className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_RATIO}>Not set</SelectItem>
                  {ASPECT_RATIOS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-editor" className="text-xs">
                Editor
              </Label>
              <AssigneeSelect id="task-editor" slot="EDITOR" label="Editor" value={editorId} members={members} otherSlotUserId={qcId} onChange={setEditorId} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-qc" className="text-xs">
                QC reviewer
              </Label>
              <AssigneeSelect id="task-qc" slot="QC_REVIEWER" label="QC reviewer" value={qcId} members={members} otherSlotUserId={editorId} onChange={setQcId} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-due" className="text-xs">
                Internal QC due
              </Label>
              <Input id="task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-client" className="text-xs">
                Client deadline
              </Label>
              <Input id="task-client" type="date" value={client} onChange={(e) => setClient(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
          {warning && (
            <p className="-mt-2 text-xs text-muted-foreground" role="status">
              {warning}
            </p>
          )}

          <fieldset className="space-y-3 rounded-lg border border-border/70 p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Links (optional)</legend>
            {LINK_FIELDS.map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`task-${key}`} className="text-xs">
                  {label}
                </Label>
                <Input
                  id={`task-${key}`}
                  type="url"
                  inputMode="url"
                  value={links[key]}
                  onChange={(e) => setLinks((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  aria-invalid={!!errors[key]}
                  aria-describedby={errors[key] ? `task-${key}-error` : undefined}
                  className="h-9 text-sm"
                />
                <FieldError id={`task-${key}-error`} message={errors[key] ?? null} />
              </div>
            ))}
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default TaskDialog;

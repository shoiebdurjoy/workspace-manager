import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, FormError } from '@/components/auth/AuthLayout';
import { useCreateSpace, useUpdateSpace } from '@/hooks/use-hierarchy';
import { DEFAULT_COLOR, validateDescription, validateHierarchyName } from '@/lib/hierarchy';
import type { HierarchySpace, Space } from '@/types/database';
import { ColorPicker, IconPicker } from './pickers';
import SpaceIcon from './SpaceIcon';

interface SpaceDialogProps {
  /** Present when editing, absent when creating. */
  space?: HierarchySpace;
  onClose: () => void;
  onSaved: (space: Space) => void;
}

const SpaceDialog: React.FC<SpaceDialogProps> = ({ space, onClose, onSaved }) => {
  const editing = !!space;
  const create = useCreateSpace();
  const update = useUpdateSpace();
  const [name, setName] = useState(space?.name ?? '');
  const [description, setDescription] = useState(space?.description ?? '');
  const [icon, setIcon] = useState(space?.icon ?? 'folder');
  const [color, setColor] = useState(space?.color ?? DEFAULT_COLOR);
  const [nameError, setNameError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const saving = create.isPending || update.isPending;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nErr = validateHierarchyName(name, 'space');
    const dErr = validateDescription(description);
    setNameError(nErr);
    setDescriptionError(dErr);
    if (nErr || dErr) return;
    setFormError(null);
    try {
      const saved = space
        ? await update.mutateAsync({ spaceId: space.id, name, description, icon, color })
        : await create.mutateAsync({ name, description, icon, color });
      onSaved(saved);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'The space could not be saved.');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit space' : 'New space'}</DialogTitle>
            <DialogDescription>
              A space is a major area of work, such as a client pipeline group. Folders and lists live inside it.
            </DialogDescription>
          </DialogHeader>
          <FormError message={formError} />
          <div className="space-y-1.5">
            <Label htmlFor="space-name" className="text-xs">
              Name
            </Label>
            <div className="flex items-center gap-2">
              <SpaceIcon icon={icon} color={color} size="md" />
              <Input
                id="space-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Content Pipelines"
                autoFocus
                aria-invalid={!!nameError}
                aria-describedby={nameError ? 'space-name-error' : undefined}
                className="h-9 text-sm"
              />
            </div>
            <FieldError id="space-name-error" message={nameError} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="space-description" className="text-xs">
              Description
            </Label>
            <Textarea
              id="space-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              aria-invalid={!!descriptionError}
              aria-describedby={descriptionError ? 'space-description-error' : undefined}
              className="text-sm"
            />
            <FieldError id="space-description-error" message={descriptionError} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Icon</Label>
            <IconPicker value={icon} onChange={setIcon} color={color} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Color</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? 'Save changes' : 'Create space'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default SpaceDialog;

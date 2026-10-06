import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, FormError } from '@/components/auth/AuthLayout';
import { useCreateList, useUpdateList } from '@/hooks/use-hierarchy';
import { DEFAULT_COLOR, validateDescription, validateHierarchyName } from '@/lib/hierarchy';
import type { HierarchyList, HierarchySpace, List } from '@/types/database';
import { ColorPicker } from './pickers';

const NO_FOLDER = '__none__';

interface ListDialogProps {
  space: HierarchySpace;
  /** Preselected parent folder when creating. */
  folderId?: string | null;
  /** Present when editing, absent when creating. */
  list?: HierarchyList;
  onClose: () => void;
  onSaved: (list: List) => void;
}

const ListDialog: React.FC<ListDialogProps> = ({ space, folderId, list, onClose, onSaved }) => {
  const editing = !!list;
  const create = useCreateList();
  const update = useUpdateList();
  const [name, setName] = useState(list?.name ?? '');
  const [description, setDescription] = useState(list?.description ?? '');
  const [color, setColor] = useState(list?.color ?? DEFAULT_COLOR);
  const [parent, setParent] = useState<string>(list ? (list.folderId ?? NO_FOLDER) : (folderId ?? NO_FOLDER));
  const [nameError, setNameError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const saving = create.isPending || update.isPending;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nErr = validateHierarchyName(name, 'list');
    const dErr = validateDescription(description);
    setNameError(nErr);
    setDescriptionError(dErr);
    if (nErr || dErr) return;
    setFormError(null);
    const chosenFolder = parent === NO_FOLDER ? null : parent;
    try {
      const saved = list
        ? await update.mutateAsync({ listId: list.id, spaceId: space.id, name, description, color, folderId: chosenFolder })
        : await create.mutateAsync({ spaceId: space.id, name, description, color, folderId: chosenFolder });
      onSaved(saved);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'The list could not be saved.');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit list' : 'New list'}</DialogTitle>
            <DialogDescription>
              A list is a queue of deliverables, for example one client's content. It lives in {space.name}.
            </DialogDescription>
          </DialogHeader>
          <FormError message={formError} />
          <div className="space-y-1.5">
            <Label htmlFor="list-name" className="text-xs">
              Name
            </Label>
            <Input
              id="list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 25. CLIENT NAME"
              autoFocus
              aria-invalid={!!nameError}
              aria-describedby={nameError ? 'list-name-error' : undefined}
              className="h-9 text-sm"
            />
            <FieldError id="list-name-error" message={nameError} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="list-folder" className="text-xs">
              Folder
            </Label>
            <Select value={parent} onValueChange={setParent}>
              <SelectTrigger id="list-folder" className="h-9 text-sm" aria-label="Folder">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_FOLDER}>No folder (directly in the space)</SelectItem>
                {space.folders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="list-description" className="text-xs">
              Description
            </Label>
            <Textarea
              id="list-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              aria-invalid={!!descriptionError}
              aria-describedby={descriptionError ? 'list-description-error' : undefined}
              className="text-sm"
            />
            <FieldError id="list-description-error" message={descriptionError} />
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
              {editing ? 'Save changes' : 'Create list'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ListDialog;

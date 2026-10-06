import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, FormError } from '@/components/auth/AuthLayout';
import { useCreateFolder, useUpdateFolder } from '@/hooks/use-hierarchy';
import { validateDescription, validateHierarchyName } from '@/lib/hierarchy';
import type { Folder, HierarchyFolder, HierarchySpace } from '@/types/database';

interface FolderDialogProps {
  space: HierarchySpace;
  /** Present when editing, absent when creating. */
  folder?: HierarchyFolder;
  onClose: () => void;
  onSaved: (folder: Folder) => void;
}

const FolderDialog: React.FC<FolderDialogProps> = ({ space, folder, onClose, onSaved }) => {
  const editing = !!folder;
  const create = useCreateFolder();
  const update = useUpdateFolder();
  const [name, setName] = useState(folder?.name ?? '');
  const [description, setDescription] = useState(folder?.description ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const saving = create.isPending || update.isPending;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nErr = validateHierarchyName(name, 'folder');
    const dErr = validateDescription(description);
    setNameError(nErr);
    setDescriptionError(dErr);
    if (nErr || dErr) return;
    setFormError(null);
    try {
      const saved = folder
        ? await update.mutateAsync({ folderId: folder.id, name, description })
        : await create.mutateAsync({ spaceId: space.id, name, description });
      onSaved(saved);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'The folder could not be saved.');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit folder' : 'New folder'}</DialogTitle>
            <DialogDescription>
              {editing ? `Folder in ${space.name}.` : `Folders group related lists inside ${space.name}, for example a client pod.`}
            </DialogDescription>
          </DialogHeader>
          <FormError message={formError} />
          <div className="space-y-1.5">
            <Label htmlFor="folder-name" className="text-xs">
              Name
            </Label>
            <Input
              id="folder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. CONTENT PIPELINE - POD NAME"
              autoFocus
              aria-invalid={!!nameError}
              aria-describedby={nameError ? 'folder-name-error' : undefined}
              className="h-9 text-sm"
            />
            <FieldError id="folder-name-error" message={nameError} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="folder-description" className="text-xs">
              Description
            </Label>
            <Textarea
              id="folder-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              aria-invalid={!!descriptionError}
              aria-describedby={descriptionError ? 'folder-description-error' : undefined}
              className="text-sm"
            />
            <FieldError id="folder-description-error" message={descriptionError} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? 'Save changes' : 'Create folder'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default FolderDialog;

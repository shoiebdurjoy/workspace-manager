import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormError } from '@/components/auth/AuthLayout';
import { useSaveTemplate } from '@/hooks/use-templates';

/** Save a list's standard videos as a template: new client lists can then start from it in one click. */
const SaveTemplateDialog: React.FC<{ listId: string; listName: string; onClose: () => void }> = ({ listId, listName, onClose }) => {
  const save = useSaveTemplate();
  const [name, setName] = useState(listName);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Give the template a name.');
    setError(null);
    try {
      await save.mutateAsync({ listId, name });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The template could not be saved.');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
            <DialogDescription>
              Keeps this list's videos with their briefs, priorities, aspect ratios and subtasks. People, dates, links and progress are not copied.
            </DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <div className="space-y-1.5">
            <Label htmlFor="template-name" className="text-xs">
              Template name
            </Label>
            <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus className="h-9 text-sm" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save template
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default SaveTemplateDialog;

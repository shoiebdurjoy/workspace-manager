import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { FieldError } from '@/components/auth/AuthLayout';
import {
  useCreateField,
  useCustomFields,
  useDeleteField,
  useFieldValueCount,
  useReorderFields,
  useUpdateField,
} from '@/hooks/use-custom-fields';
import {
  FIELDS_PER_WORKSPACE_MAX,
  FIELD_NAME_MAX,
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  optionsToText,
  parseOptions,
  validateFieldName,
  validateFieldOptions,
} from '@/lib/custom-fields';
import type { CustomField, CustomFieldType } from '@/types/database';

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const OptionsHelp = 'One choice per line, up to 30.';

/** Add / edit form. A field's type is chosen once, when it is created, and never changes. */
const FieldForm: React.FC<{
  existing?: CustomField;
  others: readonly string[];
  busy: boolean;
  onSubmit: (v: { name: string; type: CustomFieldType; options: string[] }) => Promise<unknown>;
  onCancel?: () => void;
}> = ({ existing, others, busy, onSubmit, onCancel }) => {
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<CustomFieldType>(existing?.type ?? 'text');
  const [optionsText, setOptionsText] = useState(optionsToText(existing?.options));
  const [nameError, setNameError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const idBase = existing ? `field-${existing.id}` : 'new-field';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nErr = validateFieldName(name, others);
    const options = type === 'dropdown' ? parseOptions(optionsText) : [];
    const oErr = type === 'dropdown' ? validateFieldOptions(options) : null;
    setNameError(nErr);
    setOptionsError(oErr);
    if (nErr || oErr) return;
    try {
      await onSubmit({ name: name.trim(), type, options });
      if (!existing) {
        setName('');
        setOptionsText('');
        setType('text');
      }
    } catch {
      // the hook already told the person why; keep the form as typed
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3 rounded-md border border-border/70 p-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idBase}-name`} className="text-xs">
          Field name
        </Label>
        <Input
          id={`${idBase}-name`}
          value={name}
          maxLength={FIELD_NAME_MAX + 20}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!nameError}
          aria-describedby={nameError ? `${idBase}-name-error` : undefined}
          className="h-9 text-sm"
        />
        <FieldError id={`${idBase}-name-error`} message={nameError} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idBase}-type`} className="text-xs">
          Type
        </Label>
        <select
          id={`${idBase}-type`}
          value={type}
          disabled={!!existing}
          onChange={(e) => setType(e.target.value as CustomFieldType)}
          className={SELECT_CLASS}
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        {existing && <p className="text-[11px] text-muted-foreground">The type cannot be changed after the field is created.</p>}
      </div>
      {type === 'dropdown' && (
        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-options`} className="text-xs">
            Choices
          </Label>
          <Textarea
            id={`${idBase}-options`}
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            rows={4}
            aria-invalid={!!optionsError}
            aria-describedby={`${idBase}-options-help${optionsError ? ` ${idBase}-options-error` : ''}`}
            className="text-sm"
          />
          <p id={`${idBase}-options-help`} className="text-[11px] text-muted-foreground">
            {OptionsHelp}
            {existing ? ' Removing a choice that is in use leaves those values as they are.' : ''}
          </p>
          <FieldError id={`${idBase}-options-error`} message={optionsError} />
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {existing ? 'Save field' : 'Add field'}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
};

const DeleteFieldDialog: React.FC<{ field: CustomField; onClose: () => void }> = ({ field, onClose }) => {
  const count = useFieldValueCount(field.id);
  const remove = useDeleteField();
  const description = count.isLoading
    ? 'Checking how many tasks use this field...'
    : count.isError
      ? 'Every value saved in this field, on every task, will be permanently deleted. This cannot be undone.'
      : count.data
        ? `The field and its ${count.data} saved ${count.data === 1 ? 'value' : 'values'} on tasks will be permanently deleted. This cannot be undone.`
        : 'No task has a value in this field. The field will be permanently deleted.';

  const confirm = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      await remove.mutateAsync(field.id);
      onClose();
    } catch {
      // the hook already showed the error; keep the dialog open
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && !remove.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete the field "{field.name}"?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={remove.isPending || count.isLoading}
            onClick={(e) => void confirm(e)}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {remove.isPending ? 'Deleting...' : 'Delete field'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

/**
 * Settings > Custom fields, for Owner / Admin / Production Manager (the caller decides who sees it; the
 * database decides who may write). Add, rename, edit the choices of a dropdown, re-order and delete.
 */
const CustomFieldsManager: React.FC = () => {
  const fields = useCustomFields();
  const create = useCreateField();
  const update = useUpdateField();
  const reorder = useReorderFields();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CustomField | null>(null);
  const list = fields.data ?? [];
  const atLimit = list.length >= FIELDS_PER_WORKSPACE_MAX;

  const move = (index: number, by: -1 | 1) => {
    const ids = list.map((f) => f.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + by, 0, id);
    reorder.mutate(ids);
  };

  return (
    <section aria-label="Custom fields" className="space-y-3 rounded-lg border border-border/70 bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">Custom fields</h2>
        <p className="text-xs text-muted-foreground">
          Extra information every task can carry, such as links or a video format. Owner, Admin and Production Manager manage them.
        </p>
      </div>

      {fields.isError && <p role="alert" className="text-xs text-destructive">The fields could not be loaded.</p>}
      {fields.isSuccess && list.length === 0 && <p className="text-xs text-muted-foreground">No custom fields yet.</p>}

      <ul className="divide-y divide-border/50">
        {list.map((field, index) => (
          <li key={field.id} className="py-2">
            {editingId === field.id ? (
              <FieldForm
                existing={field}
                others={list.filter((f) => f.id !== field.id).map((f) => f.name)}
                busy={update.isPending}
                onCancel={() => setEditingId(null)}
                onSubmit={async (v) => {
                  await update.mutateAsync({
                    fieldId: field.id,
                    patch: { name: v.name, ...(field.type === 'dropdown' ? { options: v.options } : {}) },
                  });
                  setEditingId(null);
                }}
              />
            ) : (
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{field.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {FIELD_TYPE_LABELS[field.type]}
                    {field.type === 'dropdown' && field.options ? `: ${field.options.join(', ')}` : ''}
                  </p>
                </div>
                <IconButton
                  aria-label={`Move ${field.name} up`}
                  icon={<ArrowUp className="h-3.5 w-3.5" />}
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7"
                  disabled={index === 0 || reorder.isPending}
                  onClick={() => move(index, -1)}
                />
                <IconButton
                  aria-label={`Move ${field.name} down`}
                  icon={<ArrowDown className="h-3.5 w-3.5" />}
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7"
                  disabled={index === list.length - 1 || reorder.isPending}
                  onClick={() => move(index, 1)}
                />
                <IconButton
                  aria-label={`Edit ${field.name}`}
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7"
                  onClick={() => setEditingId(field.id)}
                />
                <IconButton
                  aria-label={`Delete ${field.name}`}
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7"
                  onClick={() => setDeleting(field)}
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      {atLimit ? (
        <p className="text-xs text-muted-foreground">A workspace can have at most {FIELDS_PER_WORKSPACE_MAX} custom fields.</p>
      ) : (
        <FieldForm
          others={list.map((f) => f.name)}
          busy={create.isPending}
          onSubmit={(v) => create.mutateAsync({ name: v.name, type: v.type, options: v.options, position: list.length })}
        />
      )}

      {deleting && <DeleteFieldDialog field={deleting} onClose={() => setDeleting(null)} />}
    </section>
  );
};

export default CustomFieldsManager;

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
  formatFieldValue,
  hasChoices,
  optionsToText,
  parseOptions,
  validateFieldName,
  validateFieldOptions,
  validateFieldValue,
} from '@/lib/custom-fields';
import { useHierarchy } from '@/hooks/use-hierarchy';
import type { CustomField, CustomFieldType, CustomFieldValue } from '@/types/database';

export interface FieldFormValues {
  name: string;
  type: CustomFieldType;
  options: string[];
  isRequired: boolean;
  defaultValue: CustomFieldValue | null;
  folderIds: string[];
}

/** What the default box shows for a stored default (labels as "a, b"). */
const defaultToText = (field?: CustomField) =>
  field?.defaultValue === undefined || field.defaultValue === null ? '' : Array.isArray(field.defaultValue) ? field.defaultValue.join(', ') : String(field.defaultValue);

const SELECT_CLASS =
  'focus-soft h-10 w-full rounded-control border border-input bg-background px-3 text-sm outline-none transition-shadow';

const OptionsHelp = 'One choice per line, up to 30.';

/** Add / edit form. A field's type is chosen once, when it is created, and never changes. */
const FieldForm: React.FC<{
  existing?: CustomField;
  others: readonly string[];
  busy: boolean;
  onSubmit: (v: FieldFormValues) => Promise<unknown>;
  onCancel?: () => void;
}> = ({ existing, others, busy, onSubmit, onCancel }) => {
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<CustomFieldType>(existing?.type ?? 'text');
  const [optionsText, setOptionsText] = useState(optionsToText(existing?.options));
  const [nameError, setNameError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [isRequired, setIsRequired] = useState(existing?.isRequired ?? false);
  const [defaultText, setDefaultText] = useState(defaultToText(existing));
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [folderIds, setFolderIds] = useState<string[]>(existing?.folderIds ?? []);
  const folders = (useHierarchy().data ?? []).flatMap((sp) => sp.folders.map((f) => ({ id: f.id, name: f.name })));
  const idBase = existing ? `field-${existing.id}` : 'new-field';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nErr = validateFieldName(name, others);
    const options = hasChoices(type) ? parseOptions(optionsText) : [];
    const oErr = hasChoices(type) ? validateFieldOptions(options) : null;
    // the default is typed like a value ("a, b" for labels; "true" for a ticked checkbox)
    const parsed = validateFieldValue(type, options, type === 'labels' ? JSON.stringify(defaultText.split(',').map((x) => x.trim()).filter(Boolean)) : defaultText);
    const dErr = parsed.ok ? null : parsed.error;
    setNameError(nErr);
    setOptionsError(oErr);
    setDefaultError(dErr);
    if (nErr || oErr || dErr) return;
    try {
      await onSubmit({ name: name.trim(), type, options, isRequired, defaultValue: parsed.ok ? parsed.value : null, folderIds });
      if (!existing) {
        setName('');
        setOptionsText('');
        setType('text');
        setIsRequired(false);
        setDefaultText('');
        setFolderIds([]);
      }
    } catch {
      // the hook already told the person why; keep the form as typed
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3 rounded-control border border-border/70 bg-muted/20 p-3">
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
      {hasChoices(type) && (
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
      <details className="group rounded-control border border-border/60 bg-background/40 px-3 py-2" open={!!existing && (existing.isRequired || existing.defaultValue !== null || !!existing.folderIds)}>
        <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">More settings: required, default, where it shows</summary>
        <div className="mt-3 space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
            Required (tasks without it are flagged)
          </label>
          <div className="space-y-1.5">
            <Label htmlFor={`${idBase}-default`} className="text-xs">
              Default for new tasks
            </Label>
            {type === 'checkbox' ? (
              <label className="flex items-center gap-2 text-sm">
                <input id={`${idBase}-default`} type="checkbox" checked={defaultText === 'true'} onChange={(e) => setDefaultText(e.target.checked ? 'true' : '')} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                Ticked on new tasks
              </label>
            ) : (
              <Input
                id={`${idBase}-default`}
                value={defaultText}
                onChange={(e) => setDefaultText(e.target.value)}
                placeholder={type === 'labels' ? 'Choices separated by commas' : type === 'rating' ? '1 to 5' : type === 'date' ? 'YYYY-MM-DD' : 'Leave empty for none'}
                aria-invalid={!!defaultError}
                className="h-9 text-sm"
              />
            )}
            <FieldError id={`${idBase}-default-error`} message={defaultError} />
          </div>
          {folders.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium">Show only in these folders (none ticked = everywhere)</legend>
              <div className="flex flex-wrap gap-1.5">
                {folders.map((f) => {
                  const on = folderIds.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFolderIds(on ? folderIds.filter((x) => x !== f.id) : [...folderIds, f.id])}
                      className={`press rounded-full border px-2.5 py-1 text-[11px] transition-colors ${on ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
                    >
                      {f.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>
      </details>
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
      ? 'Every value saved in this field, on every task, will be deleted. It goes to the trash: an owner, admin or production manager can restore it for 30 days (Settings > Customize workspace > Trash).'
      : count.data
        ? `The field and its ${count.data} saved ${count.data === 1 ? 'value' : 'values'} on tasks will be deleted. It goes to the trash: an owner, admin or production manager can restore it for 30 days (Settings > Customize workspace > Trash).`
        : 'No task has a value in this field. The field will be deleted. It goes to the trash: an owner, admin or production manager can restore it for 30 days (Settings > Customize workspace > Trash).';

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
    <section aria-label="Custom fields" className="space-y-3 surface-card p-4">
      <div>
        <h2 className="section-label">Custom fields</h2>
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
                    patch: {
                      name: v.name,
                      ...(hasChoices(field.type) ? { options: v.options } : {}),
                      isRequired: v.isRequired,
                      defaultValue: v.defaultValue,
                      folderIds: v.folderIds,
                    },
                  });
                  setEditingId(null);
                }}
              />
            ) : (
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {field.name}
                    {field.isRequired && <span className="ml-1 text-destructive" title="Required">*</span>}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {FIELD_TYPE_LABELS[field.type]}
                    {hasChoices(field.type) && field.options ? `: ${field.options.join(', ')}` : ''}
                    {field.defaultValue !== null ? ` · default ${formatFieldValue(field, field.defaultValue)}` : ''}
                    {field.folderIds && field.folderIds.length > 0 ? ` · only in ${field.folderIds.length} folder${field.folderIds.length === 1 ? '' : 's'}` : ''}
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
          onSubmit={async (v) => {
            const created = await create.mutateAsync({ name: v.name, type: v.type, options: v.options, position: list.length });
            if (v.isRequired || v.defaultValue !== null || v.folderIds.length > 0) {
              await update.mutateAsync({ fieldId: created.id, patch: { isRequired: v.isRequired, defaultValue: v.defaultValue, folderIds: v.folderIds } });
            }
          }}
        />
      )}

      {deleting && <DeleteFieldDialog field={deleting} onClose={() => setDeleting(null)} />}
    </section>
  );
};

export default CustomFieldsManager;

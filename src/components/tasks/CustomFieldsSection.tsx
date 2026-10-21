import React from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { useCustomFields, useSetFieldValue, useTaskFieldValues } from '@/hooks/use-custom-fields';
import { canEditFieldValue, formatFieldValue, validateFieldValue, valueToInput } from '@/lib/custom-fields';
import { isValidTaskUrl, linkHost } from '@/lib/tasks';
import type { CustomField, CustomFieldValue } from '@/types/database';
import { InlineText } from './fields';
import { GHOST_SELECT_TRIGGER, STATIC_VALUE } from './task-styles';

const NONE = '__none__';

interface CustomFieldsSectionProps {
  taskId: string;
  isAssignedEditor: boolean;
}

const checkValue = (field: CustomField) => (raw: string): string | null => {
  const parsed = validateFieldValue(field.type, field.options, raw);
  return parsed.ok ? null : parsed.error;
};

const ReadOnlyValue: React.FC<{ field: CustomField; value: CustomFieldValue | undefined }> = ({ field, value }) => {
  if (value === undefined) return <span className={`${STATIC_VALUE} text-muted-foreground/70`}>Not set</span>;
  const text = formatFieldValue(field, value);
  if (field.type === 'url' && typeof value === 'string' && isValidTaskUrl(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${field.name} (${linkHost(value) ?? 'link'})`}
        className="flex h-8 min-w-0 items-center gap-1.5 px-2 text-sm font-medium text-brand hover:underline"
      >
        <span className="truncate">{linkHost(value)}</span>
        <ExternalLink aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </a>
    );
  }
  return <span className="block min-w-0 break-words px-2 py-1.5 text-sm">{text}</span>;
};

/**
 * One row per workspace custom field, editable in place by whoever may write values on this task (managers
 * and QC; an editor on their own tasks) and plain text for everyone else. Hidden when the workspace has no
 * fields. Saves on blur / Enter / pick; a refused save shows a message and puts the old value back.
 */
const CustomFieldsSection: React.FC<CustomFieldsSectionProps> = ({ taskId, isAssignedEditor }) => {
  const { role } = useAuth();
  const fields = useCustomFields();
  const values = useTaskFieldValues(taskId);
  const setValue = useSetFieldValue(taskId);
  const [hideEmpty, setHideEmpty] = React.useState(false);
  const editable = canEditFieldValue(role, isAssignedEditor);

  const list = fields.data ?? [];
  if (list.length === 0) return null;
  const stored = values.data;
  const visible = hideEmpty ? list.filter((f) => stored?.has(f.id)) : list;

  /** Validates again (the input already did) and saves; rejects when the database refuses. */
  const save = (field: CustomField, raw: string) => {
    const parsed = validateFieldValue(field.type, field.options, raw);
    if (!parsed.ok) return Promise.reject(new Error(parsed.error));
    return setValue.mutateAsync({ fieldId: field.id, value: parsed.value });
  };

  return (
    <section aria-label="Fields" className="space-y-2.5">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fields</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={hideEmpty}
          className="h-6 px-2 text-[11px] font-normal text-muted-foreground"
          onClick={() => setHideEmpty((v) => !v)}
        >
          {hideEmpty ? 'Show empty fields' : 'Hide empty fields'}
        </Button>
      </div>
      {values.isError && <p role="alert" className="text-xs text-destructive">The field values could not be loaded.</p>}
      {visible.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">No fields have a value yet.</p>
      ) : (
        <div className="divide-y divide-border/50">
          {visible.map((field) => {
            const value = stored?.get(field.id);
            return (
              <div key={field.id} className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-x-2 py-1.5">
                <span className="mt-1.5 break-words text-xs font-medium text-muted-foreground" title={field.name}>
                  {field.name}
                </span>
                {!editable ? (
                  <ReadOnlyValue field={field} value={value} />
                ) : field.type === 'dropdown' ? (
                  <Select
                    value={typeof value === 'string' ? value : NONE}
                    onValueChange={(v) => void save(field, v === NONE ? '' : v).catch(() => undefined)}
                  >
                    <SelectTrigger aria-label={field.name} className={GHOST_SELECT_TRIGGER}>
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Not set</SelectItem>
                      {/* a value whose choice was removed stays visible until someone changes it */}
                      {typeof value === 'string' && !(field.options ?? []).includes(value) && <SelectItem value={value}>{value}</SelectItem>}
                      {(field.options ?? []).map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.type === 'date' ? (
                  <input
                    type="date"
                    aria-label={field.name}
                    value={valueToInput(value)}
                    onChange={(e) => void save(field, e.target.value).catch(() => undefined)}
                    className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                ) : (
                  <div className="flex min-w-0 items-center gap-1">
                    <InlineText
                      label={field.name}
                      hideLabel
                      type={field.type === 'url' ? 'url' : 'text'}
                      value={valueToInput(value)}
                      placeholder={field.type === 'url' ? 'https://' : field.type === 'number' ? 'Number' : 'Add a value'}
                      validate={checkValue(field)}
                      onCommit={(v) => save(field, v)}
                      className="min-w-0 flex-1"
                      inputClassName="h-8"
                    />
                    {field.type === 'url' && typeof value === 'string' && isValidTaskUrl(value) && (
                      <a
                        href={value}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${field.name} (${linkHost(value) ?? 'link'})`}
                        className="mt-1.5 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default CustomFieldsSection;

import type { CustomField, CustomFieldType, CustomFieldValue, TbbRole } from '@/types/database';
import { isValidTaskUrl } from '@/lib/tasks';
import { canAttachFiles } from '@/lib/collaboration';

/**
 * Pure helpers for Phase 12 custom fields. The database (RLS + guard triggers) is the authority on every
 * rule here; these give a readable message before the round trip and format stored values for display.
 */

export const FIELD_NAME_MAX = 60;
export const FIELD_OPTION_MAX = 60;
export const FIELD_OPTIONS_MAX = 30;
export const FIELDS_PER_WORKSPACE_MAX = 50;
export const TEXT_VALUE_MAX = 2000;
export const URL_VALUE_MAX = 2048;

export const LONG_TEXT_VALUE_MAX = 10000;

export const FIELD_TYPES: readonly CustomFieldType[] = ['text', 'long_text', 'url', 'number', 'money', 'dropdown', 'labels', 'date', 'checkbox', 'rating', 'people', 'email', 'phone'];

export const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  long_text: 'Long text',
  url: 'Link',
  number: 'Number',
  money: 'Money',
  dropdown: 'Dropdown',
  labels: 'Labels (pick several)',
  date: 'Date',
  checkbox: 'Checkbox',
  rating: 'Rating (1-5)',
  people: 'Person',
  email: 'E-mail',
  phone: 'Phone',
};

/** Types whose values come from the field's own list of choices. */
export const hasChoices = (type: CustomFieldType) => type === 'dropdown' || type === 'labels';

/** Null when fine. `others` are the other fields' names (a name is unique per workspace, ignoring case). */
export function validateFieldName(name: string, others: readonly string[] = []): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a name for the field.';
  if (trimmed.length > FIELD_NAME_MAX) return `The name can be at most ${FIELD_NAME_MAX} characters.`;
  if (others.some((o) => o.trim().toLowerCase() === trimmed.toLowerCase())) return 'Another field already has this name.';
  return null;
}

/** One choice per line; blank lines are dropped and surrounding spaces trimmed. */
export function parseOptions(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function optionsToText(options: readonly string[] | null | undefined): string {
  return (options ?? []).join('\n');
}

export function validateFieldOptions(options: readonly string[]): string | null {
  if (options.length === 0) return 'Add at least one choice.';
  if (options.length > FIELD_OPTIONS_MAX) return `A dropdown can have at most ${FIELD_OPTIONS_MAX} choices.`;
  if (options.some((o) => o.length > FIELD_OPTION_MAX)) return `A choice can be at most ${FIELD_OPTION_MAX} characters.`;
  if (new Set(options).size !== options.length) return 'Each choice must be different.';
  return null;
}

export type ParsedValue = { ok: true; value: CustomFieldValue | null } | { ok: false; error: string };

/** A real calendar day written YYYY-MM-DD. */
export function isValidIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Turns what a person typed (or picked) into the value to store, or an error message. An empty input is
 * `{ ok: true, value: null }`: it clears the field (the row is deleted, never stored as null).
 */
export function validateFieldValue(type: CustomFieldType, options: readonly string[] | null, raw: string): ParsedValue {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  switch (type) {
    case 'text':
      if (trimmed.length > TEXT_VALUE_MAX) return { ok: false, error: `This can be at most ${TEXT_VALUE_MAX.toLocaleString()} characters.` };
      return { ok: true, value: trimmed };
    case 'long_text':
      if (trimmed.length > LONG_TEXT_VALUE_MAX) return { ok: false, error: `This can be at most ${LONG_TEXT_VALUE_MAX.toLocaleString()} characters.` };
      return { ok: true, value: trimmed };
    case 'url':
      if (trimmed.length > URL_VALUE_MAX) return { ok: false, error: `The link can be at most ${URL_VALUE_MAX} characters.` };
      if (!isValidTaskUrl(trimmed)) return { ok: false, error: 'Enter a full link that starts with http:// or https://.' };
      return { ok: true, value: trimmed };
    case 'number':
    case 'money': {
      const n = Number(trimmed.replace(/[,$€£৳\s]/g, ''));
      if (!Number.isFinite(n)) return { ok: false, error: 'Enter a number.' };
      return { ok: true, value: n };
    }
    case 'rating': {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 1 || n > 5) return { ok: false, error: 'Pick a rating from 1 to 5.' };
      return { ok: true, value: n };
    }
    case 'checkbox':
      return trimmed === 'true' ? { ok: true, value: true } : { ok: true, value: null };
    case 'dropdown':
      if (!(options ?? []).includes(trimmed)) return { ok: false, error: 'Pick one of the choices.' };
      return { ok: true, value: trimmed };
    case 'labels': {
      // the editor sends the picked choices as a JSON list
      let picked: unknown;
      try {
        picked = JSON.parse(trimmed);
      } catch {
        picked = trimmed.split(',').map((x) => x.trim());
      }
      const list = Array.isArray(picked) ? picked.filter((x): x is string => typeof x === 'string' && !!x) : [];
      if (list.length === 0) return { ok: true, value: null };
      if (list.some((x) => !(options ?? []).includes(x))) return { ok: false, error: 'Pick from the choices.' };
      return { ok: true, value: Array.from(new Set(list)) };
    }
    case 'people':
      if (!/^[0-9a-f-]{36}$/i.test(trimmed)) return { ok: false, error: 'Pick a person.' };
      return { ok: true, value: trimmed };
    case 'email':
      if (trimmed.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return { ok: false, error: 'Enter an e-mail address.' };
      return { ok: true, value: trimmed };
    case 'phone':
      if (!/^[0-9+() .-]{3,40}$/.test(trimmed)) return { ok: false, error: 'Enter a phone number (digits, spaces, + - ( ) .).' };
      return { ok: true, value: trimmed };
    case 'date':
      if (!isValidIsoDay(trimmed)) return { ok: false, error: 'Enter a real date.' };
      return { ok: true, value: trimmed };
    default:
      return { ok: false, error: 'Unknown field type.' };
  }
}

/** Managers and QC on any task; an editor on the tasks assigned to them (same rule as attaching files). */
export function canEditFieldValue(role: TbbRole | null | undefined, isAssignedEditor: boolean): boolean {
  return canAttachFiles(role, isAssignedEditor);
}

/** What a stored value looks like as plain text; empty for no value. `people` resolves a member id to a name. */
export function formatFieldValue(field: Pick<CustomField, 'type'>, value: CustomFieldValue | undefined, people?: (id: string) => string): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (field.type === 'checkbox') return value === true ? 'Yes' : '';
  if (field.type === 'rating' && typeof value === 'number') return '★'.repeat(value) + '☆'.repeat(Math.max(0, 5 - value));
  if (field.type === 'money' && typeof value === 'number') return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (field.type === 'people' && typeof value === 'string') return people ? people(value) : value;
  if (field.type === 'number') return typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 10 }) : String(value);
  if (field.type === 'date' && typeof value === 'string' && isValidIsoDay(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return String(value);
}

/** The value as the edit box shows it (a number without grouping, so it can be re-parsed). */
export function valueToInput(value: CustomFieldValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

export function readOptions(raw: unknown): string[] | null {
  return Array.isArray(raw) ? raw.filter((o): o is string => typeof o === 'string') : null;
}

/** A stored JSON value as the app's value type; undefined for anything unexpected. */
export function readValue(raw: unknown): CustomFieldValue | undefined {
  if (typeof raw === 'string' || typeof raw === 'number') return raw;
  if (raw === true) return true;
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  return undefined;
}

/** Fields that apply to a list in this folder (a field limited to folders is hidden elsewhere). */
export function fieldsForFolder<T extends Pick<CustomField, 'folderIds'>>(fields: readonly T[], folderId: string | null | undefined): T[] {
  return fields.filter((f) => !f.folderIds || f.folderIds.length === 0 || (!!folderId && f.folderIds.includes(folderId)));
}

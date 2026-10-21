import { describe, expect, it } from 'vitest';
import {
  canEditFieldValue,
  formatFieldValue,
  isValidIsoDay,
  optionsToText,
  parseOptions,
  readOptions,
  validateFieldName,
  validateFieldOptions,
  validateFieldValue,
  valueToInput,
} from '../custom-fields';

describe('field names and options', () => {
  it('validates the name', () => {
    expect(validateFieldName('HOOK VARIATION')).toBeNull();
    expect(validateFieldName('   ')).toMatch(/Enter a name/);
    expect(validateFieldName('x'.repeat(61))).toMatch(/60/);
    expect(validateFieldName('x'.repeat(60))).toBeNull();
    expect(validateFieldName(' hook variation ', ['HOOK VARIATION'])).toMatch(/already has this name/);
  });

  it('parses one choice per line, dropping blanks and trimming', () => {
    expect(parseOptions('16:9\n  9:16 \r\n\n1:1\n')).toEqual(['16:9', '9:16', '1:1']);
    expect(optionsToText(['a', 'b'])).toBe('a\nb');
    expect(optionsToText(null)).toBe('');
  });

  it('validates the choices like the database', () => {
    expect(validateFieldOptions(['a', 'b'])).toBeNull();
    expect(validateFieldOptions([])).toMatch(/at least one/);
    expect(validateFieldOptions(Array.from({ length: 31 }, (_, i) => `c${i}`))).toMatch(/30/);
    expect(validateFieldOptions(Array.from({ length: 30 }, (_, i) => `c${i}`))).toBeNull();
    expect(validateFieldOptions(['x'.repeat(61)])).toMatch(/60/);
    expect(validateFieldOptions(['a', 'a'])).toMatch(/different/);
  });

  it('reads stored options defensively', () => {
    expect(readOptions(['a', 1, 'b'])).toEqual(['a', 'b']);
    expect(readOptions(null)).toBeNull();
    expect(readOptions('x')).toBeNull();
  });
});

describe('validateFieldValue', () => {
  it('an empty input clears the field for every type', () => {
    for (const t of ['text', 'url', 'number', 'dropdown', 'date'] as const) {
      expect(validateFieldValue(t, ['a'], '  ')).toEqual({ ok: true, value: null });
    }
  });

  it('text is trimmed and capped at 2000', () => {
    expect(validateFieldValue('text', null, ' hi ')).toEqual({ ok: true, value: 'hi' });
    expect(validateFieldValue('text', null, 'x'.repeat(2000)).ok).toBe(true);
    expect(validateFieldValue('text', null, 'x'.repeat(2001)).ok).toBe(false);
  });

  it('url must be a full http(s) link', () => {
    expect(validateFieldValue('url', null, 'https://www.loom.com/share/a')).toEqual({ ok: true, value: 'https://www.loom.com/share/a' });
    expect(validateFieldValue('url', null, 'loom.com').ok).toBe(false);
    expect(validateFieldValue('url', null, 'javascript:alert(1)').ok).toBe(false);
    expect(validateFieldValue('url', null, 'https://a.co/' + 'x'.repeat(2048)).ok).toBe(false);
  });

  it('number must be finite', () => {
    expect(validateFieldValue('number', null, '12')).toEqual({ ok: true, value: 12 });
    expect(validateFieldValue('number', null, '-3.5')).toEqual({ ok: true, value: -3.5 });
    expect(validateFieldValue('number', null, '1,200')).toEqual({ ok: true, value: 1200 });
    expect(validateFieldValue('number', null, 'abc').ok).toBe(false);
    expect(validateFieldValue('number', null, 'Infinity').ok).toBe(false);
  });

  it('dropdown must be one of the choices', () => {
    expect(validateFieldValue('dropdown', ['16:9', '9:16'], '9:16')).toEqual({ ok: true, value: '9:16' });
    expect(validateFieldValue('dropdown', ['16:9'], '4:3').ok).toBe(false);
    expect(validateFieldValue('dropdown', null, '4:3').ok).toBe(false);
  });

  it('date must be a real YYYY-MM-DD day', () => {
    expect(validateFieldValue('date', null, '2032-02-29').ok).toBe(true);
    expect(validateFieldValue('date', null, '2031-02-29').ok).toBe(false);
    expect(validateFieldValue('date', null, '2030-13-01').ok).toBe(false);
    expect(validateFieldValue('date', null, '28/02/2030').ok).toBe(false);
    expect(isValidIsoDay('2030-02-28')).toBe(true);
  });
});

describe('who can edit and how values show', () => {
  it('managers and QC always, an editor only on their own task, nobody else', () => {
    for (const role of ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST'] as const) {
      expect(canEditFieldValue(role, false)).toBe(true);
    }
    expect(canEditFieldValue('EDITOR', true)).toBe(true);
    expect(canEditFieldValue('EDITOR', false)).toBe(false);
    expect(canEditFieldValue('CLIENT_VIEWER', true)).toBe(false);
    expect(canEditFieldValue(null, true)).toBe(false);
  });

  it('formats values for display and for the edit box', () => {
    expect(formatFieldValue({ type: 'text' }, undefined)).toBe('');
    expect(formatFieldValue({ type: 'text' }, 'hello')).toBe('hello');
    expect(formatFieldValue({ type: 'number' }, 3)).toBe('3');
    expect(formatFieldValue({ type: 'date' }, '2030-02-28')).toMatch(/2030/);
    expect(formatFieldValue({ type: 'date' }, 'garbage')).toBe('garbage');
    expect(valueToInput(1200)).toBe('1200');
    expect(valueToInput(undefined)).toBe('');
  });
});

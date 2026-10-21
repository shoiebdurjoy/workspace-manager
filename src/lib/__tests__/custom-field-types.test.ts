import { describe, expect, it } from 'vitest';
import { fieldsForFolder, formatFieldValue, readValue, validateFieldValue } from '../custom-fields';

describe('the new custom field types', () => {
  it('parses each type from what the editor sends', () => {
    expect(validateFieldValue('checkbox', null, 'true')).toEqual({ ok: true, value: true });
    expect(validateFieldValue('checkbox', null, '')).toEqual({ ok: true, value: null });
    expect(validateFieldValue('labels', ['TikTok', 'Reels'], '["Reels","TikTok","Reels"]')).toEqual({ ok: true, value: ['Reels', 'TikTok'] });
    expect(validateFieldValue('labels', ['TikTok'], '["Facebook"]').ok).toBe(false);
    expect(validateFieldValue('labels', ['TikTok'], '[]')).toEqual({ ok: true, value: null });
    expect(validateFieldValue('rating', null, '4')).toEqual({ ok: true, value: 4 });
    expect(validateFieldValue('rating', null, '6').ok).toBe(false);
    expect(validateFieldValue('money', null, '$1,250.50')).toEqual({ ok: true, value: 1250.5 });
    expect(validateFieldValue('email', null, 'client@brand.com').ok).toBe(true);
    expect(validateFieldValue('email', null, 'nope').ok).toBe(false);
    expect(validateFieldValue('phone', null, '+880 1711-000000').ok).toBe(true);
    expect(validateFieldValue('phone', null, 'call me').ok).toBe(false);
    expect(validateFieldValue('people', null, '0b8a2c4e-1111-4a2b-9c3d-123456789abc').ok).toBe(true);
    expect(validateFieldValue('long_text', null, 'x'.repeat(5000)).ok).toBe(true);
  });

  it('formats stored values for reading', () => {
    expect(formatFieldValue({ type: 'rating' }, 3)).toBe('★★★☆☆');
    expect(formatFieldValue({ type: 'labels' }, ['TikTok', 'Reels'])).toBe('TikTok, Reels');
    expect(formatFieldValue({ type: 'checkbox' }, true)).toBe('Yes');
    expect(formatFieldValue({ type: 'people' }, 'u1', () => 'Zim')).toBe('Zim');
    expect(readValue(['a', 1])).toEqual(['a']);
    expect(readValue({})).toBeUndefined();
  });

  it('hides a field outside the folders it is limited to', () => {
    const fields = [{ id: 'all', folderIds: null }, { id: 'zim', folderIds: ['fz'] }];
    expect(fieldsForFolder(fields, 'fz').map((f) => f.id)).toEqual(['all', 'zim']);
    expect(fieldsForFolder(fields, 'fm').map((f) => f.id)).toEqual(['all']);
    expect(fieldsForFolder(fields, null).map((f) => f.id)).toEqual(['all']);
  });
});

import { describe, expect, it } from 'vitest';
import { entryMinutes, formatMinutes } from '../time-format';

describe('time tracking helpers', () => {
  it('formats minutes as hours and minutes', () => {
    expect(formatMinutes(95)).toBe('1 h 35 min');
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatMinutes(7)).toBe('7 min');
  });
  it('measures finished and running entries', () => {
    expect(entryMinutes({ startedAt: '2026-10-22T10:00:00Z', endedAt: '2026-10-22T11:30:00Z' })).toBe(90);
    expect(entryMinutes({ startedAt: '2026-10-22T10:00:00Z', endedAt: null }, Date.parse('2026-10-22T10:20:00Z'))).toBe(20);
  });
});

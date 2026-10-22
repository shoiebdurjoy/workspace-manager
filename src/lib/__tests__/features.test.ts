import { describe, expect, it } from 'vitest';
import { FEATURES, featureFlags, isFeatureOn } from '../features';

describe('feature switches', () => {
  it('everything is on until an admin switches it off', () => {
    expect(isFeatureOn({ settings: {} }, 'reports')).toBe(true);
    expect(isFeatureOn(null, 'reports')).toBe(true);
    expect(isFeatureOn({ settings: { features: { reports: false } } }, 'reports')).toBe(false);
    expect(isFeatureOn({ settings: { features: { reports: false } } }, 'calendar')).toBe(true);
    expect(featureFlags({ settings: { features: 'junk' } })).toEqual({});
  });
  it('lists every switch the database accepts, once', () => {
    const keys = FEATURES.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(13);
  });
});

import { describe, expect, it } from 'vitest';
import { pickDefaultView, sameQuery, type SavedView } from '../savedViews';

const v = (over: Partial<SavedView>): SavedView => ({ id: 'x', ownerId: 'me', scope: 'l', name: 'v', query: '', mode: 'list', isShared: false, isDefault: false, ...over });

describe('saved views', () => {
  it('a person\'s own default wins over the team default', () => {
    const team = v({ id: 'team', isShared: true, isDefault: true, ownerId: 'boss' });
    const mine = v({ id: 'mine', isDefault: true });
    expect(pickDefaultView([team, mine], 'me')?.id).toBe('mine');
    expect(pickDefaultView([team, mine], 'someone-else')?.id).toBe('team');
    expect(pickDefaultView([v({})], 'me')).toBeNull();
  });
  it('compares filters regardless of their order', () => {
    expect(sameQuery('status=A&group=list', 'group=list&status=A')).toBe(true);
    expect(sameQuery('status=A', 'status=B')).toBe(false);
  });
});

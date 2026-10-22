import { describe, expect, it } from 'vitest';
import {
  groupByDay,
  readInboxParams,
  writeInboxParams,
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
  COMMENT_MAX_LENGTH,
  activeMentionQuery,
  attachmentMimeType,
  attachmentPath,
  canAttachFiles,
  canDeleteAttachment,
  canDeleteComment,
  canEditComment,
  commentPlainText,
  describeActivity,
  describeNotification,
  formatBytes,
  insertMention,
  mentionCandidates,
  mentionToken,
  mentionedIds,
  mergeActivity,
  notificationPath,
  parseComment,
  sortAttachments,
  sortComments,
  storageFileName,
  timeAgo,
  validateAttachmentFile,
  validateComment,
} from '../collaboration';
import { memberLookup } from '../tasks';
import { MEMBERS, PEOPLE } from '@/test/task-fixtures';
import { TBB_WORKFLOW } from '@/test/workflow-fixture';
import type { ActivityEntry, AppNotification } from '@/types/database';

const UID = '11111111-1111-4111-8111-111111111111';
const UID2 = '22222222-2222-4222-8222-222222222222';
const WS = '33333333-3333-4333-8333-333333333333';
const TASK = '44444444-4444-4444-8444-444444444444';
const ATT = '55555555-5555-4555-8555-555555555555';

describe('comment text', () => {
  it('refuses an empty or oversized comment', () => {
    expect(validateComment('   ')).toMatch(/Write a comment/);
    expect(validateComment('x'.repeat(COMMENT_MAX_LENGTH + 1))).toMatch(/at most 10,000/);
    expect(validateComment('x'.repeat(COMMENT_MAX_LENGTH))).toBeNull();
    expect(validateComment(' hi ')).toBeNull();
  });
});

describe('mentions', () => {
  it('writes a token the database reads, without any character that could end it early', () => {
    expect(mentionToken('Quinn QC', UID)).toBe(`@[Quinn QC](${UID})`);
    expect(mentionToken('Evil] (x) [name\n', UID)).toBe(`@[Evil (x) name](${UID})`);
    expect(mentionToken('   ', UID)).toBe(`@[member](${UID})`);
    expect(mentionToken('x'.repeat(300), UID)).toHaveLength(`@[${'x'.repeat(100)}](${UID})`.length);
  });

  it('parses text and mentions in order', () => {
    const parts = parseComment(`Hi @[Quinn QC](${UID}), please check @[Mia](${UID2}).`);
    expect(parts).toEqual([
      { type: 'text', text: 'Hi ' },
      { type: 'mention', name: 'Quinn QC', userId: UID },
      { type: 'text', text: ', please check ' },
      { type: 'mention', name: 'Mia', userId: UID2 },
      { type: 'text', text: '.' },
    ]);
  });

  it('only a complete, well-formed token is a mention', () => {
    for (const bad of ['@[no id]()', `@[name](not-a-uuid)`, `@[](${UID})`, `@name`, `[Quinn](${UID})`, `@[a\nb](${UID})`]) {
      expect(parseComment(bad).every((p) => p.type === 'text'), bad).toBe(true);
    }
  });

  it('lists each person once, lower-cased', () => {
    expect(mentionedIds(`@[A](${UID.toUpperCase()}) @[B](${UID}) @[C](${UID2})`)).toEqual([UID, UID2]);
  });

  it('turns tokens back into @Name for previews', () => {
    expect(commentPlainText(`Hi   @[Quinn QC](${UID})\n\nthanks`)).toBe('Hi @Quinn QC thanks');
  });

  describe('typing "@"', () => {
    it('opens only at the start or after whitespace, so an e-mail address never does', () => {
      expect(activeMentionQuery('@', 1)).toEqual({ start: 0, query: '' });
      expect(activeMentionQuery('hello @qu', 9)).toEqual({ start: 6, query: 'qu' });
      expect(activeMentionQuery('line\n@x', 7)).toEqual({ start: 5, query: 'x' });
      expect(activeMentionQuery('mail me at pat@example.com', 26)).toBeNull();
    });

    it('closes when the query gets too long or hits a bracket or line break', () => {
      expect(activeMentionQuery(`@${'a'.repeat(31)}`, 32)).toBeNull();
      expect(activeMentionQuery('@a]', 3)).toBeNull();
      expect(activeMentionQuery('@a\nb', 4)).toBeNull();
      expect(activeMentionQuery('no at sign', 4)).toBeNull();
    });

    it('only looks left of the caret', () => {
      expect(activeMentionQuery('@qu and more', 3)).toEqual({ start: 0, query: 'qu' });
    });

    it('replaces the query with a finished token and moves the caret after it', () => {
      const text = 'Hi @qu there';
      const q = activeMentionQuery(text, 6)!;
      const out = insertMention(text, 6, q, 'Quinn QC', UID);
      expect(out.text).toBe(`Hi @[Quinn QC](${UID})  there`);
      expect(out.caret).toBe(`Hi @[Quinn QC](${UID}) `.length);
    });
  });

  describe('who can be mentioned', () => {
    const base = memberLookup(MEMBERS);
    it('offers staff matching the query, names starting with it first, yourself last', () => {
      const list = [...base.values()];
      expect(mentionCandidates(list, 'qu', PEOPLE.me).map((m) => m.userId)).toEqual([PEOPLE.qc]);
      // "a" matches names containing it; those starting with "a" (Ada) come first
      const a = mentionCandidates(list, 'a', PEOPLE.me).map((m) => m.profile?.fullName);
      expect(a[0]).toBe('Ada Admin');
      expect(a[a.length - 1]).toBe('Pat Person');
    });

    it('never offers client viewers or deactivated people', () => {
      const members = [
        ...MEMBERS,
        { ...MEMBERS[0], userId: 'client', role: 'CLIENT_VIEWER' as const, profile: { ...MEMBERS[0].profile!, id: 'client', fullName: 'Cleo Client' } },
        { ...MEMBERS[0], userId: 'gone', profile: { ...MEMBERS[0].profile!, id: 'gone', fullName: 'Gone Away', isActive: false } },
      ];
      const names = mentionCandidates(members, '', PEOPLE.me, 20).map((m) => m.profile?.fullName);
      expect(names).not.toContain('Cleo Client');
      expect(names).not.toContain('Gone Away');
    });

    it('caps the list', () => {
      expect(mentionCandidates(MEMBERS, '', null, 2)).toHaveLength(2);
    });
  });

  it('orders a conversation oldest first, stable on ties', () => {
    const items = [
      { id: 'b', createdAt: '2026-10-02T10:00:00Z' },
      { id: 'a', createdAt: '2026-10-02T10:00:00Z' },
      { id: 'c', createdAt: '2026-10-01T10:00:00Z' },
    ];
    expect(sortComments(items).map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('comment permissions mirror the policies', () => {
  const mine = { authorId: 'me' };
  const theirs = { authorId: 'other' };
  const former = { authorId: null };
  it('only the author edits', () => {
    expect(canEditComment(mine, 'me')).toBe(true);
    expect(canEditComment(theirs, 'me')).toBe(false);
    expect(canEditComment(former, 'me')).toBe(false);
    expect(canEditComment(mine, null)).toBe(false);
  });
  it('the author or an owner/admin deletes', () => {
    expect(canDeleteComment(mine, 'me', 'EDITOR')).toBe(true);
    expect(canDeleteComment(theirs, 'me', 'EDITOR')).toBe(false);
    expect(canDeleteComment(theirs, 'me', 'PRODUCTION_MANAGER')).toBe(false);
    expect(canDeleteComment(theirs, 'me', 'QC_SPECIALIST')).toBe(false);
    expect(canDeleteComment(theirs, 'me', 'ADMIN')).toBe(true);
    expect(canDeleteComment(former, 'me', 'OWNER')).toBe(true);
    expect(canDeleteComment(theirs, 'me', null)).toBe(false);
  });
});

describe('attachments', () => {
  const file = (name: string, size = 1000, type = '') => ({ name, size, type });

  it('allows what the bucket allows and nothing else', () => {
    expect(ATTACHMENT_TYPES.map((t) => t.mime)).not.toContain('text/html');
    expect(ATTACHMENT_TYPES.map((t) => t.mime)).not.toContain('image/svg+xml');
    expect(ATTACHMENT_ACCEPT).toContain('.pdf');
    expect(ATTACHMENT_ACCEPT).not.toContain('.exe');
    expect(ATTACHMENT_ACCEPT).not.toContain('.html');
  });

  it('uses the browser type when it is allowed, else the extension, and never trusts a contradicting extension', () => {
    expect(attachmentMimeType(file('a.pdf', 1, 'application/pdf'))).toBe('application/pdf');
    expect(attachmentMimeType(file('notes.md', 1, ''))).toBe('text/markdown');
    expect(attachmentMimeType(file('data.CSV', 1, 'application/octet-stream'))).toBe('text/csv');
    expect(attachmentMimeType(file('photo.png', 1, 'application/pdf'))).toBe('application/pdf');
    expect(attachmentMimeType(file('script.pdf', 1, 'text/html'))).toBeNull();
    expect(attachmentMimeType(file('run.exe', 1, 'application/x-msdownload'))).toBeNull();
    expect(attachmentMimeType(file('run.exe', 1, ''))).toBeNull();
    expect(attachmentMimeType(file('noextension', 1, ''))).toBeNull();
    expect(attachmentMimeType(file('.hidden', 1, ''))).toBeNull();
  });

  it('validates size, emptiness, type and name with a readable message', () => {
    expect(validateAttachmentFile(file('cut.pdf', 1000, 'application/pdf'))).toBeNull();
    expect(validateAttachmentFile(file('cut.pdf', 0, 'application/pdf'))).toMatch(/is empty/);
    expect(validateAttachmentFile(file('big.zip', ATTACHMENT_MAX_BYTES, 'application/zip'))).toBeNull();
    expect(validateAttachmentFile(file('big.zip', ATTACHMENT_MAX_BYTES + 1, 'application/zip'))).toMatch(/at most 25 MB.*Drive or Frame\.io/);
    expect(validateAttachmentFile(file('run.exe', 10, 'application/x-msdownload'))).toMatch(/cannot be attached/);
    expect(validateAttachmentFile(file('a/b.pdf', 10, 'application/pdf'))).toMatch(/not valid/);
    expect(validateAttachmentFile(file('a\\b.pdf', 10, 'application/pdf'))).toMatch(/not valid/);
    expect(validateAttachmentFile(file(`${'x'.repeat(200)}.pdf`, 10, 'application/pdf'))).toMatch(/not valid/);
    expect(validateAttachmentFile(file('  ', 10, 'application/pdf'))).toMatch(/no name/);
  });

  it('turns any name into a storage-safe one that keeps the extension', () => {
    expect(storageFileName('Résumé of the cut — v2.PDF')).toBe('Resume-of-the-cut-v2.pdf');
    expect(storageFileName('../../etc/passwd')).toBe('passwd');
    expect(storageFileName('a b/c\\d.mp3')).toBe('d.mp3');
    expect(storageFileName('a b.mp3')).toBe('a-b.mp3');
    expect(storageFileName('....')).toBe('file');
    expect(storageFileName('日本語.png')).toBe('file.png');
    expect(storageFileName(`${'x'.repeat(300)}.pdf`).length).toBeLessThanOrEqual(111);
    expect(storageFileName('noext')).toBe('noext');
  });

  it('builds the exact path the storage policies read', () => {
    const path = attachmentPath(WS, TASK, ATT, 'My Cut Notes.PDF');
    expect(path).toBe(`${WS}/${TASK}/${ATT}/My-Cut-Notes.pdf`);
    // the storage policy's shape: three lower-case uuids and a plain file name
    expect(path).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}(\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}){2}\/[A-Za-z0-9._-]{1,180}$/);
  });

  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(150 * 1024)).toBe('150 KB');
    expect(formatBytes(5.5 * 1024 * 1024)).toBe('5.5 MB');
    expect(formatBytes(ATTACHMENT_MAX_BYTES)).toBe('25 MB');
    expect(formatBytes(-1)).toBe('');
  });

  it('newest file first', () => {
    const list = [{ id: 'a', createdAt: '2026-10-01T00:00:00Z' }, { id: 'b', createdAt: '2026-10-02T00:00:00Z' }];
    expect(sortAttachments(list).map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('who may attach and who may delete mirrors migration 13', () => {
    expect(canAttachFiles('OWNER', false)).toBe(true);
    expect(canAttachFiles('ADMIN', false)).toBe(true);
    expect(canAttachFiles('PRODUCTION_MANAGER', false)).toBe(true);
    expect(canAttachFiles('QC_SPECIALIST', false)).toBe(true);
    expect(canAttachFiles('EDITOR', true)).toBe(true);
    expect(canAttachFiles('EDITOR', false)).toBe(false);
    expect(canAttachFiles('CLIENT_VIEWER', true)).toBe(false);
    expect(canAttachFiles(null, true)).toBe(false);
    expect(canDeleteAttachment({ uploadedBy: 'me' }, 'me', 'EDITOR')).toBe(true);
    expect(canDeleteAttachment({ uploadedBy: 'x' }, 'me', 'EDITOR')).toBe(false);
    expect(canDeleteAttachment({ uploadedBy: 'x' }, 'me', 'QC_SPECIALIST')).toBe(false);
    expect(canDeleteAttachment({ uploadedBy: 'x' }, 'me', 'PRODUCTION_MANAGER')).toBe(true);
    expect(canDeleteAttachment({ uploadedBy: null }, 'me', 'ADMIN')).toBe(true);
  });
});

describe('activity sentences', () => {
  const ctx = { members: memberLookup(MEMBERS), workflow: TBB_WORKFLOW, listName: (id: string) => (id === 'l2' ? 'Conor' : undefined) };
  const act = (kind: string, data: Record<string, unknown>, actorId: string | null = PEOPLE.manager): ActivityEntry => ({
    source: 'activity', id: `${kind}-1`, taskId: 't', actorId, createdAt: '2026-10-05T10:00:00Z', kind: kind as never, data,
  });

  it('says who did what, from the stored row', () => {
    expect(describeActivity(act('created', {}), ctx)).toMatchObject({ actor: 'Mia Manager', text: 'created the task' });
    expect(describeActivity(act('assigned', { role_type: 'EDITOR', user_id: PEOPLE.me }), ctx).text).toBe('assigned Pat Person as editor');
    expect(describeActivity(act('assigned', { role_type: 'QC_REVIEWER', user_id: PEOPLE.qc }), ctx).text).toBe('assigned Quinn QC as QC reviewer');
    expect(describeActivity(act('unassigned', { role_type: 'EDITOR', user_id: PEOPLE.me }), ctx).text).toBe('removed Pat Person as editor');
    expect(describeActivity(act('attachment_added', { file_name: 'cut.pdf' }), ctx).text).toBe('attached cut.pdf');
    expect(describeActivity(act('attachment_removed', { file_name: 'cut.pdf' }), ctx).text).toBe('removed cut.pdf');
    expect(describeActivity(act('commented', { comment_id: 'c1' }), ctx)).toMatchObject({ text: 'commented', commentId: 'c1' });
  });

  it('describes property changes, small values as from-to and long text only as "changed"', () => {
    const line = describeActivity(
      act('updated', {
        changes: [
          { field: 'priority', from: 'MEDIUM', to: 'URGENT' },
          { field: 'title', from: 'Old', to: 'New' },
          { field: 'due_date', from: null, to: '2026-10-12T00:00:00Z' },
          { field: 'description', changed: true },
          { field: 'review_link', changed: true },
          { field: 'list', from: 'l1', to: 'l2' },
        ],
      }),
      ctx
    );
    expect(line.text).toContain('changed the priority from Normal to Urgent');
    expect(line.text).toContain('renamed the task from “Old” to “New”');
    expect(line.text).toMatch(/changed the internal QC due date from none to .*2026/);
    expect(line.text).toContain('changed the brief');
    expect(line.text).toContain('changed the review link');
    expect(line.text).toContain('moved the task to Conor');
  });

  it('names a stage change with the workflow names, the override and the revision note', () => {
    const entry: ActivityEntry = {
      source: 'status', id: 's1', taskId: 't', actorId: PEOPLE.qc, createdAt: '2026-10-05T11:00:00Z',
      event: { id: 's1', taskId: 't', from: 'QC_FIRST_APPROVAL', to: 'QC_REVISION_NEEDED', actorId: PEOPLE.qc, note: 'Tighten the intro', isOverride: false, revisionNumber: 2, createdAt: '2026-10-05T11:00:00Z' },
    };
    const line = describeActivity(entry, ctx);
    expect(line.text).toBe('moved the task from QC - FIRST APPROVAL to QC - REVISION NEEDED · revision 2');
    expect(line.detail).toBe('Tighten the intro');
    const override = describeActivity({ ...entry, event: { ...entry.event, isOverride: true, revisionNumber: null, note: null } } as ActivityEntry, ctx);
    expect(override.text).toContain('(manager override)');
    const first = describeActivity({ ...entry, event: { ...entry.event, from: null, to: 'TO_BE_EDITED' } } as ActivityEntry, ctx);
    expect(first.text).toBe('created the task as TO BE EDITED');
  });

  it('survives a missing actor, an unknown kind and odd data', () => {
    expect(describeActivity(act('created', {}, null), ctx).actor).toBe('Someone');
    expect(describeActivity(act('assigned', { role_type: 'EDITOR', user_id: 'ghost' }), ctx).text).toBe('assigned Former member as editor');
    expect(describeActivity(act('whatever', {}), ctx).text).toBe('updated the task');
    expect(describeActivity(act('updated', { changes: 'nope' }), ctx).text).toBe('updated the task');
  });

  it('merges newest first with a stable tie-break and a limit', () => {
    const e = (id: string, at: string): ActivityEntry => ({ source: 'activity', id, taskId: 't', actorId: null, createdAt: at, kind: 'created', data: {} });
    const merged = mergeActivity([e('a', '2026-10-01T00:00:00Z'), e('c', '2026-10-03T00:00:00Z'), e('b', '2026-10-03T00:00:00Z')]);
    expect(merged.map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect(mergeActivity(merged, 2).map((x) => x.id)).toEqual(['c', 'b']);
  });
});

describe('notifications', () => {
  const n = (kind: AppNotification['kind'], data: Record<string, unknown>, extra: Partial<AppNotification> = {}): AppNotification => ({
    id: 'n1', userId: 'me', workspaceId: 'ws', taskId: TASK, actorId: PEOPLE.qc, kind, data, readAt: null, archivedAt: null, createdAt: '2026-10-05T10:00:00Z', ...extra,
  });
  const lookup = memberLookup(MEMBERS);

  it('links to the task, on the tab and comment that show what happened, using ids only', () => {
    expect(notificationPath(n('mention', { comment_id: UID }))).toBe(`/tasks/${TASK}?tab=comments&comment=${UID}`);
    expect(notificationPath(n('comment', { comment_id: UID }))).toBe(`/tasks/${TASK}?tab=comments&comment=${UID}`);
    expect(notificationPath(n('assigned', {}))).toBe(`/tasks/${TASK}?tab=activity`);
    expect(notificationPath(n('status', {}))).toBe(`/tasks/${TASK}?tab=activity`);
    // a stored value that is not an id is never put in the address
    expect(notificationPath(n('mention', { comment_id: '"><script>' }))).toBe(`/tasks/${TASK}?tab=activity`);
    expect(notificationPath(n('mention', {}))).toBe(`/tasks/${TASK}?tab=activity`);
  });

  it('writes the headline and detail', () => {
    expect(describeNotification(n('mention', { title: 'Founder story', snippet: 'Hi @Pat, can you check?', comment_id: UID }), lookup)).toMatchObject({
      headline: 'Quinn QC mentioned you',
      detail: 'Founder story · “Hi @Pat, can you check?”',
      unread: true,
    });
    expect(describeNotification(n('comment', { title: 'Founder story' }), lookup).headline).toBe('Quinn QC commented');
    expect(describeNotification(n('assigned', { title: 'Founder story', role_type: 'EDITOR' }), lookup).headline).toBe('Quinn QC assigned you as editor');
    expect(describeNotification(n('assigned', { title: 'T', role_type: 'QC_REVIEWER' }, { actorId: null }), lookup).headline).toBe('You were assigned as QC reviewer');
    expect(describeNotification(n('status', { title: 'Founder story', to: 'QC_REVISION_NEEDED' }), lookup, TBB_WORKFLOW).headline).toBe('Quinn QC moved a task to QC - REVISION NEEDED');
    expect(describeNotification(n('status', { title: 'T' }, { actorId: null }), lookup).headline).toBe('Someone moved a task to a new stage');
  });

  it('reports read state and falls back when the task title is missing', () => {
    expect(describeNotification(n('comment', {}, { readAt: '2026-10-05T11:00:00Z' }), lookup)).toMatchObject({ unread: false, detail: 'a task' });
  });
});

describe('timeAgo', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it('speaks plainly', () => {
    expect(timeAgo(ago(10_000), now)).toBe('just now');
    expect(timeAgo(ago(5 * 60_000), now)).toBe('5 min ago');
    expect(timeAgo(ago(3 * 3_600_000), now)).toBe('3 h ago');
    expect(timeAgo(ago(30 * 3_600_000), now)).toBe('yesterday');
    expect(timeAgo(ago(3 * 86_400_000), now)).toBe('3 days ago');
    expect(timeAgo(ago(30 * 86_400_000), now)).toMatch(/Sep/);
    expect(timeAgo('not a date', now)).toBe('');
  });
});

describe('Inbox (Phase 11)', () => {
  it('reads the tab, kinds and unread-only from the address, dropping anything unknown', () => {
    expect(readInboxParams(new URLSearchParams(''))).toEqual({ tab: 'inbox', kinds: [], unreadOnly: false });
    expect(readInboxParams(new URLSearchParams('tab=done&kind=mention,evil,status,mention&unread=1'))).toEqual({
      tab: 'done',
      kinds: ['mention', 'status'],
      unreadOnly: true,
    });
    expect(readInboxParams(new URLSearchParams('tab=archive&unread=yes')).tab).toBe('inbox');
    expect(readInboxParams(new URLSearchParams('unread=yes')).unreadOnly).toBe(false);
  });

  it('writes only what differs from the default, and keeps other parameters', () => {
    const p = writeInboxParams(new URLSearchParams('x=1'), { tab: 'all', kinds: ['comment'], unreadOnly: true });
    expect(p.toString()).toBe('x=1&tab=all&kind=comment&unread=1');
    const back = writeInboxParams(p, { tab: 'inbox', kinds: [], unreadOnly: false });
    expect(back.toString()).toBe('x=1');
  });

  it('groups newest-first items by the viewer calendar day, keeping their order', () => {
    const now = new Date(2026, 9, 21, 9, 0);
    const at = (daysAgo: number, hour = 8) => ({ createdAt: new Date(2026, 9, 21 - daysAgo, hour).toISOString(), id: `${daysAgo}-${hour}` });
    const items = [at(0, 8), at(0, 1), at(1, 23), at(2), at(6), at(7), at(40)];
    const groups = groupByDay(items, now);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Today', ['0-8', '0-1']],
      ['Yesterday', ['1-23']],
      ['Earlier this week', ['2-8', '6-8']],
      ['Older', ['7-8', '40-8']],
    ]);
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe('automation notices', () => {
  it('show the automation message instead of a stage move', async () => {
    const { describeNotification } = await import('../collaboration');
    const d = describeNotification(
      { id: 'n', kind: 'status', actorId: null, readAt: null, createdAt: '2026-10-22T00:00:00Z', taskId: 't', workspaceId: 'w', userId: 'u', data: { automation: 'Client wants changes', message: 'Client asked for changes', task_title: 'CC R01' } } as never,
      new Map() as never,
      null
    );
    expect(d.headline).toBe('Client asked for changes');
    expect(d.detail).toMatch(/automation "Client wants changes"/);
  });
});

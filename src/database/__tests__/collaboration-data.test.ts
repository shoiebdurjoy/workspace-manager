import { beforeEach, describe, expect, it, vi } from 'vitest';

type Err = { code?: string; message: string } | null;
interface Result { data?: unknown; error?: Err; count?: number | null }

const results: Record<string, Result> = {};
const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
const removed: string[][] = [];
const signed: Array<{ path: string; seconds: number; options: unknown }> = [];
let signedResult: { data: { signedUrl: string } | null; error: Err } = { data: { signedUrl: 'https://signed.example/x' }, error: null };
let session: { access_token: string } | null = { access_token: 'jwt-token' };
const channels: Array<{ name: string; filter: string; callback: (p: unknown) => void; status?: (s: string) => void; removed: boolean }> = [];

function builder(table: string) {
  const b: Record<string, unknown> = {
    then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null, ...(results[table] ?? { data: [] }) }).then(resolve, reject),
  };
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit', 'single', 'in', 'is', 'or', 'not']) {
    b[m] = (...args: unknown[]) => {
      calls.push({ table, method: m, args });
      return b;
    };
  }
  return b;
}

vi.mock('../config', () => ({
  getDatabaseConfig: () => ({ supabaseUrl: 'https://proj.supabase.co/', supabaseAnonKey: 'anon-key', isConfigured: true, validationError: null }),
}));
vi.mock('../client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => builder(table),
    auth: { getSession: () => Promise.resolve({ data: { session } }) },
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          removed.push([bucket, ...paths]);
          return Promise.resolve({ data: [], error: null });
        },
        createSignedUrl: (path: string, seconds: number, options: unknown) => {
          signed.push({ path, seconds, options });
          return Promise.resolve(signedResult);
        },
      }),
    },
    channel: (name: string) => {
      const entry = { name, filter: '', callback: (_p: unknown): void => undefined, status: undefined as ((s: string) => void) | undefined, removed: false };
      channels.push(entry);
      const chain = {
        on: (_t: string, opts: { filter: string }, cb: (p: unknown) => void) => {
          entry.filter = opts.filter;
          entry.callback = cb;
          return chain;
        },
        subscribe: (cb?: (s: string) => void) => {
          entry.status = cb;
          cb?.('SUBSCRIBED');
          return chain;
        },
      };
      return chain;
    },
    removeChannel: (ch: unknown) => {
      const e = channels.find((c) => ch === c || true);
      if (e) e.removed = true;
      return Promise.resolve('ok');
    },
  }),
}));

import {
  addComment,
  buildUploadRequest,
  countUnreadNotifications,
  deleteAttachment,
  deleteComment,
  editComment,
  getAttachmentUrl,
  listAttachments,
  listComments,
  listNotifications,
  listTaskActivity,
  mapAttachmentRow,
  mapCommentRow,
  markAllNotificationsRead,
  markNotificationUnread,
  markNotificationsRead,
  subscribeToNotifications,
  taskFilePaths,
  uploadAttachment,
} from '../collaboration';
import { PermissionDeniedError, ValidationError, DatabaseError } from '../errors';

const at = (table: string, method: string) => calls.filter((c) => c.table === table && c.method === method);
const WS = '33333333-3333-4333-8333-333333333333';
const TASK = '44444444-4444-4444-8444-444444444444';

const commentRow = {
  id: 'c1', task_id: TASK, workspace_id: WS, author_id: 'u1', body: 'Hi', mentions: ['u2'],
  created_at: '2026-10-05T10:00:00Z', updated_at: '2026-10-05T10:00:00Z', edited_at: null,
};
const attachmentRow = {
  id: 'a1', task_id: TASK, workspace_id: WS, uploaded_by: 'u1', file_name: 'cut.pdf', storage_path: `${WS}/${TASK}/a1/cut.pdf`,
  mime_type: 'application/pdf', size_bytes: 2048, created_at: '2026-10-05T10:00:00Z',
};

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k];
  calls.length = 0;
  removed.length = 0;
  signed.length = 0;
  channels.length = 0;
  signedResult = { data: { signedUrl: 'https://signed.example/x' }, error: null };
  session = { access_token: 'jwt-token' };
});

describe('comments', () => {
  it('lists one task\'s comments oldest first, capped', async () => {
    results.task_comments = { data: [commentRow] };
    const list = await listComments(TASK);
    expect(list).toEqual([{ id: 'c1', taskId: TASK, workspaceId: WS, authorId: 'u1', body: 'Hi', mentions: ['u2'], createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z', editedAt: null }]);
    expect(at('task_comments', 'eq')[0].args).toEqual(['task_id', TASK]);
    expect(at('task_comments', 'order')[0].args).toEqual(['created_at', { ascending: true }]);
    expect(at('task_comments', 'limit')[0].args).toEqual([500]);
    await expect(listComments('')).rejects.toBeInstanceOf(ValidationError);
  });

  it('maps a null mentions column to an empty list', () => {
    expect(mapCommentRow({ ...commentRow, mentions: null as unknown as string[] }).mentions).toEqual([]);
  });

  it('posts ONLY the task and the text (author, workspace and mentions are the database\'s), keeping a given id', async () => {
    results.task_comments = { data: commentRow };
    await addComment(TASK, '  Hi @[X](id)  ', 'new-id');
    const [insert] = at('task_comments', 'insert');
    expect(insert.args[0]).toEqual({ id: 'new-id', task_id: TASK, body: 'Hi @[X](id)' });
    await addComment(TASK, 'plain');
    expect(at('task_comments', 'insert')[1].args[0]).toEqual({ task_id: TASK, body: 'plain' });
  });

  it('refuses an empty comment before any request', async () => {
    await expect(addComment(TASK, '   ')).rejects.toBeInstanceOf(ValidationError);
    await expect(addComment('', 'x')).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);
  });

  it('turns a refusal into a readable error', async () => {
    results.task_comments = { error: { code: '42501', message: 'new row violates row-level security policy' } };
    await expect(addComment(TASK, 'x')).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('edits through UPDATE and treats zero rows as "not yours"', async () => {
    results.task_comments = { data: [{ ...commentRow, body: 'Hi again', edited_at: '2026-10-05T11:00:00Z' }] };
    const saved = await editComment('c1', ' Hi again ');
    expect(saved.editedAt).toBe('2026-10-05T11:00:00Z');
    expect(at('task_comments', 'update')[0].args[0]).toEqual({ body: 'Hi again' });
    expect(at('task_comments', 'eq')[0].args).toEqual(['id', 'c1']);
    results.task_comments = { data: [] };
    await expect(editComment('c1', 'x')).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(editComment('c1', '')).rejects.toBeInstanceOf(ValidationError);
  });

  it('deletes and treats zero rows as "not yours"', async () => {
    results.task_comments = { data: [{ id: 'c1' }] };
    await deleteComment('c1');
    expect(at('task_comments', 'delete')).toHaveLength(1);
    results.task_comments = { data: [] };
    await expect(deleteComment('c1')).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe('attachments: records', () => {
  it('lists a task\'s files, newest first, with the size as a number', async () => {
    results.task_attachments = { data: [attachmentRow] };
    const [a] = await listAttachments(TASK);
    expect(a).toMatchObject({ id: 'a1', fileName: 'cut.pdf', sizeBytes: 2048, uploadedBy: 'u1', mimeType: 'application/pdf' });
    // a bigint can arrive as text: it is still a number in the app
    expect(mapAttachmentRow({ ...attachmentRow, size_bytes: '4096' as unknown as number }).sizeBytes).toBe(4096);
    expect(mapAttachmentRow(attachmentRow).storagePath).toBe(`${WS}/${TASK}/a1/cut.pdf`);
    expect(at('task_attachments', 'order')[0].args).toEqual(['created_at', { ascending: false }]);
  });

  it('opens through a short-lived signed link, asking for a download name only when downloading', async () => {
    const att = { storagePath: 'p/q/r/cut.pdf', fileName: 'Cut notes.pdf' };
    expect(await getAttachmentUrl(att)).toBe('https://signed.example/x');
    expect(await getAttachmentUrl(att, { download: true })).toBe('https://signed.example/x');
    expect(signed).toEqual([
      { path: 'p/q/r/cut.pdf', seconds: 60, options: undefined },
      { path: 'p/q/r/cut.pdf', seconds: 60, options: { download: 'Cut notes.pdf' } },
    ]);
    signedResult = { data: null, error: { message: 'Object not found' } };
    await expect(getAttachmentUrl(att)).rejects.toBeInstanceOf(DatabaseError);
  });

  it('removes the record first, then the stored file, and only the person allowed to', async () => {
    results.task_attachments = { data: [{ id: 'a1' }] };
    await deleteAttachment({ id: 'a1', storagePath: 'p/q/r/cut.pdf' });
    expect(at('task_attachments', 'delete')).toHaveLength(1);
    expect(removed).toEqual([['task-attachments', 'p/q/r/cut.pdf']]);
  });

  it('keeps the file when the record could not be removed (not yours)', async () => {
    results.task_attachments = { data: [] };
    await expect(deleteAttachment({ id: 'a1', storagePath: 'p/q/r/cut.pdf' })).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(removed).toEqual([]);
  });

  it('reads the paths of tasks about to be deleted, and removes them afterwards', async () => {
    results.task_attachments = { data: [{ storage_path: 'a' }, { storage_path: 'b' }] };
    expect(await taskFilePaths(['t1', 't2'])).toEqual(['a', 'b']);
    expect(at('task_attachments', 'in')[0].args).toEqual(['task_id', ['t1', 't2']]);
    expect(await taskFilePaths([])).toEqual([]);
    results.task_attachments = { error: { message: 'boom' } };
    expect(await taskFilePaths(['t1'])).toEqual([]);
  });
});

describe('attachments: upload', () => {
  it('describes the upload request for the private bucket (the shape the live test also sends)', () => {
    const req = buildUploadRequest({ supabaseUrl: 'https://proj.supabase.co/', anonKey: 'anon', accessToken: 'tok', path: `${WS}/${TASK}/a1/cut.pdf`, contentType: 'application/pdf' });
    expect(req.url).toBe(`https://proj.supabase.co/storage/v1/object/task-attachments/${WS}/${TASK}/a1/cut.pdf`);
    expect(req.headers).toEqual({
      Authorization: 'Bearer tok',
      apikey: 'anon',
      'Content-Type': 'application/pdf',
      'Cache-Control': 'max-age=3600',
      'x-upsert': 'false',
    });
  });

  interface FakeXhr {
    method?: string; url?: string; headers: Record<string, string>; body?: unknown;
    upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void };
    status: number; responseText: string;
    onload?: () => void; onerror?: () => void; onabort?: () => void;
  }
  let xhr: FakeXhr;
  let respond: { status: number; body: string } | 'error' | 'hang' = { status: 200, body: '{}' };
  beforeEach(() => {
    xhr = undefined as unknown as FakeXhr;
    respond = { status: 200, body: '{}' };
    class XHR {
      headers: Record<string, string> = {};
      upload: FakeXhr['upload'] = {};
      status = 0;
      responseText = '';
      onload?: () => void;
      onerror?: () => void;
      onabort?: () => void;
      method?: string;
      url?: string;
      body?: unknown;
      constructor() {
        xhr = this as unknown as FakeXhr;
      }
      open(method: string, url: string) { this.method = method; this.url = url; }
      setRequestHeader(k: string, v: string) { this.headers[k] = v; }
      abort() { this.onabort?.(); }
      send(body: unknown) {
        this.body = body;
        this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
        if (respond === 'hang') return;
        const answer = respond;
        queueMicrotask(() => {
          if (answer === 'error') return this.onerror?.();
          this.status = answer.status;
          this.responseText = answer.body;
          this.onload?.();
        });
      }
    }
    vi.stubGlobal('XMLHttpRequest', XHR);
  });

  const file = (name = 'Cut notes.pdf', type = 'application/pdf', size = 2048) => new File([new Uint8Array(size)], name, { type });

  it('uploads to the right path with the user\'s token, reports progress, then records it', async () => {
    results.task_attachments = { data: attachmentRow };
    const progress: number[] = [];
    const saved = await uploadAttachment({ workspaceId: WS, taskId: TASK, file: file(), onProgress: (f) => progress.push(f) });
    expect(saved.id).toBe('a1');
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toMatch(new RegExp(`^https://proj\\.supabase\\.co/storage/v1/object/task-attachments/${WS}/${TASK}/[0-9a-f-]{36}/Cut-notes\\.pdf$`));
    expect(xhr.headers.Authorization).toBe('Bearer jwt-token');
    expect(xhr.headers.apikey).toBe('anon-key');
    expect(xhr.headers['Content-Type']).toBe('application/pdf');
    expect(xhr.headers['x-upsert']).toBe('false');
    expect(progress).toEqual([0.5, 1]);
    const [insert] = at('task_attachments', 'insert');
    const row = insert.args[0] as Record<string, unknown>;
    expect(row).toMatchObject({ task_id: TASK, file_name: 'Cut notes.pdf', mime_type: 'application/pdf', size_bytes: 2048 });
    // the record's id is the id in the path
    expect(String(row.storage_path)).toContain(`/${row.id}/`);
    // the client does not send who uploaded it, nor the workspace
    expect(row).not.toHaveProperty('uploaded_by');
    expect(row).not.toHaveProperty('workspace_id');
  });

  it('refuses a bad file before sending a byte', async () => {
    await expect(uploadAttachment({ workspaceId: WS, taskId: TASK, file: file('run.exe', 'application/x-msdownload') })).rejects.toBeInstanceOf(ValidationError);
    await expect(uploadAttachment({ workspaceId: WS, taskId: TASK, file: file('big.zip', 'application/zip', 25 * 1024 * 1024 + 1) })).rejects.toThrow(/at most 25 MB/);
    expect(xhr).toBeUndefined();
  });

  it('needs a signed-in session', async () => {
    session = null;
    await expect(uploadAttachment({ workspaceId: WS, taskId: TASK, file: file() })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('turns storage refusals into readable messages and records nothing', async () => {
    for (const [status, body, expected] of [
      [413, '{"message":"The object exceeded the maximum allowed size"}', /too large/],
      [415, '{"message":"mime type text/html is not supported"}', /cannot be attached/],
      [403, '{"message":"new row violates row-level security policy"}', /permission/],
      [409, '{"message":"The resource already exists"}', /already uploaded/],
      [500, 'oops', /could not be uploaded/],
    ] as const) {
      respond = { status, body };
      await expect(uploadAttachment({ workspaceId: WS, taskId: TASK, file: file() })).rejects.toThrow(expected);
    }
    expect(at('task_attachments', 'insert')).toHaveLength(0);
    expect(removed).toEqual([]);
  });

  it('reports an interrupted upload', async () => {
    respond = 'error';
    await expect(uploadAttachment({ workspaceId: WS, taskId: TASK, file: file() })).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('can be cancelled', async () => {
    respond = 'hang';
    const controller = new AbortController();
    const pending = uploadAttachment({ workspaceId: WS, taskId: TASK, file: file(), signal: controller.signal });
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    expect(at('task_attachments', 'insert')).toHaveLength(0);
  });

  it('removes the stored file again when the record is refused', async () => {
    results.task_attachments = { error: { code: '42501', message: 'new row violates row-level security policy' } };
    await expect(uploadAttachment({ workspaceId: WS, taskId: TASK, file: file() })).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(removed).toHaveLength(1);
    expect(removed[0][0]).toBe('task-attachments');
    expect(removed[0][1]).toMatch(new RegExp(`^${WS}/${TASK}/`));
  });
});

describe('activity', () => {
  it('merges the activity log and the status history, newest first, and reports when there is more', async () => {
    results.task_activity = {
      data: [
        { id: 'x2', task_id: TASK, workspace_id: WS, actor_id: 'u1', kind: 'commented', data: { comment_id: 'c1' }, created_at: '2026-10-05T12:00:00Z' },
        { id: 'x1', task_id: TASK, workspace_id: WS, actor_id: 'u1', kind: 'created', data: {}, created_at: '2026-10-05T10:00:00Z' },
      ],
    };
    results.task_status_events = {
      data: [{ id: 's1', task_id: TASK, workspace_id: WS, from_status: 'TO_BE_EDITED', to_status: 'ASSIGNED', actor_id: 'u2', note: null, is_override: false, revision_number: null, created_at: '2026-10-05T11:00:00Z' }],
    };
    const { entries, hasMore } = await listTaskActivity(TASK, 2);
    expect(entries.map((e) => `${e.source}:${e.id}`)).toEqual(['activity:x2', 'status:s1']);
    expect(hasMore).toBe(true);
    expect(at('task_activity', 'limit')[0].args).toEqual([3]);
    expect(at('task_status_events', 'limit')[0].args).toEqual([3]);
    const all = await listTaskActivity(TASK, 10);
    expect(all.hasMore).toBe(false);
    expect(all.entries).toHaveLength(3);
    await expect(listTaskActivity('')).rejects.toBeInstanceOf(ValidationError);
  });

  it('surfaces a failure of either source', async () => {
    results.task_activity = { error: { code: '42501', message: 'x' } };
    await expect(listTaskActivity(TASK)).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe('notifications', () => {
  const row = (n: number) => ({
    id: `n${n}`, user_id: 'me', workspace_id: WS, task_id: TASK, actor_id: 'u2', kind: 'mention', data: { title: 'T' },
    dedupe_key: `k${n}`, read_at: null, created_at: `2026-10-05T10:0${n}:00.123456+00:00`,
  });

  it('pages newest first with a keyset cursor (one extra row tells whether there is more)', async () => {
    results.notifications = { data: [row(3), row(2), row(1)] };
    const page = await listNotifications({ limit: 2 });
    expect(page.items.map((n) => n.id)).toEqual(['n3', 'n2']);
    expect(page.next).toEqual({ createdAt: '2026-10-05T10:02:00.123456+00:00', id: 'n2' });
    expect(at('notifications', 'limit')[0].args).toEqual([3]);
    expect(at('notifications', 'order').map((c) => c.args[0])).toEqual(['created_at', 'id']);
    results.notifications = { data: [row(1)] };
    expect((await listNotifications({ limit: 2 })).next).toBeNull();
  });

  it('asks for strictly older rows when given a cursor, and can ask for unread only', async () => {
    results.notifications = { data: [] };
    await listNotifications({ before: { createdAt: '2026-10-05T10:02:00.123456+00:00', id: 'n2' }, unreadOnly: true });
    expect(at('notifications', 'or')[0].args[0]).toBe('created_at.lt.2026-10-05T10:02:00.123456+00:00,and(created_at.eq.2026-10-05T10:02:00.123456+00:00,id.lt.n2)');
    expect(at('notifications', 'is')[0].args).toEqual(['read_at', null]);
  });

  it('keeps the page size within bounds', async () => {
    results.notifications = { data: [] };
    await listNotifications({ limit: 5000 });
    await listNotifications({ limit: 0 });
    expect(at('notifications', 'limit').map((c) => c.args[0])).toEqual([101, 2]);
  });

  it('counts unread without downloading them', async () => {
    results.notifications = { count: 7, data: null };
    expect(await countUnreadNotifications()).toBe(7);
    expect(at('notifications', 'select')[0].args).toEqual(['id', { count: 'exact', head: true }]);
    results.notifications = { count: null, data: null };
    expect(await countUnreadNotifications()).toBe(0);
  });

  it('marks as read only what is unread, and only the given ids', async () => {
    results.notifications = { data: null };
    await markNotificationsRead(['n1', 'n2']);
    const [update] = at('notifications', 'update');
    expect((update.args[0] as { read_at: string }).read_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(at('notifications', 'in')[0].args).toEqual(['id', ['n1', 'n2']]);
    expect(at('notifications', 'is')[0].args).toEqual(['read_at', null]);
    calls.length = 0;
    await markNotificationsRead([]);
    expect(calls).toHaveLength(0);
  });

  it('marks all unread as read and one back to unread', async () => {
    results.notifications = { data: null };
    await markAllNotificationsRead();
    expect(at('notifications', 'is')[0].args).toEqual(['read_at', null]);
    await markNotificationUnread('n1');
    const updates = at('notifications', 'update');
    expect(updates[1].args[0]).toEqual({ read_at: null });
    expect(at('notifications', 'eq')[0].args).toEqual(['id', 'n1']);
  });

  it('reports failures readably', async () => {
    results.notifications = { error: { code: '42501', message: 'x' } };
    await expect(markAllNotificationsRead()).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(listNotifications()).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('listens for this person\'s rows only and stops when asked', () => {
    const events: Array<{ type: string; id: string }> = [];
    const statuses: string[] = [];
    const stop = subscribeToNotifications('me', (e) => events.push({ type: e.type, id: e.notification.id }), (s) => statuses.push(s));
    expect(channels[0].name).toBe('notifications:me');
    expect(channels[0].filter).toBe('user_id=eq.me');
    expect(statuses).toEqual(['SUBSCRIBED']);
    channels[0].callback({ eventType: 'INSERT', new: row(1) });
    channels[0].callback({ eventType: 'UPDATE', new: { ...row(1), read_at: '2026-10-05T11:00:00Z' } });
    channels[0].callback({ eventType: 'DELETE', old: row(1) });
    expect(events).toEqual([{ type: 'INSERT', id: 'n1' }, { type: 'UPDATE', id: 'n1' }]);
    stop();
    expect(channels[0].removed).toBe(true);
  });
});

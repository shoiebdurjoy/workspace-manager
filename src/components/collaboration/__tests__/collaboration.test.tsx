import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import TaskCollaboration from '../TaskCollaboration';
import NotificationBell from '../NotificationBell';
import { makeAuth, renderWithAuth } from '@/test/auth-utils';
import type { createDatabaseMock } from '@/test/database-mock';
import * as dbModule from '@/database';
import { IDS, makeTree } from '@/test/hierarchy-fixtures';
import { MEMBERS, PEOPLE, TASK_IDS } from '@/test/task-fixtures';
import { TBB_WORKFLOW } from '@/test/workflow-fixture';
import type { ActivityEntry, AppNotification, TaskAttachment, TaskComment, TbbRole } from '@/types/database';

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

const TASK = TASK_IDS.one;
const COMMENT_A = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const COMMENT_B = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';

const Where: React.FC = () => {
  const l = useLocation();
  return <span data-testid="where">{`${l.pathname}${l.search}`}</span>;
};

function comment(over: Partial<TaskComment> = {}): TaskComment {
  return {
    id: COMMENT_A, taskId: TASK, workspaceId: 'ws-1', authorId: PEOPLE.qc, body: 'Please tighten the intro.', mentions: [],
    createdAt: new Date(Date.now() - 3600_000).toISOString(), updatedAt: new Date(Date.now() - 3600_000).toISOString(), editedAt: null, ...over,
  };
}
function file(over: Partial<TaskAttachment> = {}): TaskAttachment {
  return {
    id: 'att-1', taskId: TASK, workspaceId: 'ws-1', uploadedBy: PEOPLE.qc, fileName: 'Script v2.pdf', storagePath: 'ws/task/att-1/Script-v2.pdf',
    mimeType: 'application/pdf', sizeBytes: 150 * 1024, createdAt: new Date(Date.now() - 7200_000).toISOString(), ...over,
  };
}

function renderCollab(role: TbbRole = 'EDITOR', { route = '/', assigned = true }: { route?: string; assigned?: boolean } = {}) {
  return renderWithAuth(
    <>
      <TaskCollaboration taskId={TASK} isAssignedEditor={assigned} />
      <Where />
    </>,
    { auth: makeAuth(role), route }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  db.getWorkspaceMembers.mockResolvedValue(MEMBERS);
  db.getWorkspaceHierarchy.mockResolvedValue(makeTree());
  db.getWorkflow.mockResolvedValue(TBB_WORKFLOW);
  db.listComments.mockResolvedValue([]);
  db.listAttachments.mockResolvedValue([]);
  db.listTaskActivity.mockResolvedValue({ entries: [], hasMore: false });
  db.listNotifications.mockResolvedValue({ items: [], next: null });
  db.countUnreadNotifications.mockResolvedValue(0);
  db.markNotificationsRead.mockResolvedValue(undefined);
  db.markAllNotificationsRead.mockResolvedValue(undefined);
  db.markNotificationUnread.mockResolvedValue(undefined);
  db.subscribeToNotifications.mockReturnValue(() => undefined);
  Element.prototype.scrollIntoView = vi.fn();
});

describe('comments', () => {
  it('shows an honest empty state and a composer', async () => {
    renderCollab();
    expect(await screen.findByText('No comments yet')).toBeInTheDocument();
    expect(screen.getByLabelText('Write a comment')).toBeInTheDocument();
    expect(db.listComments).toHaveBeenCalledWith(TASK);
  });

  it('lists the conversation with author, time and the text exactly as written (never as HTML)', async () => {
    db.listComments.mockResolvedValue([
      comment({ body: 'Check https://app.frame.io/r/abc, then <img src=x onerror=alert(1)> done.' }),
      comment({ id: COMMENT_B, authorId: null, body: 'old note', createdAt: new Date().toISOString() }),
    ]);
    renderCollab();
    const list = await screen.findByRole('list', { name: 'Comments' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Quinn QC');
    expect(items[0]).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(items[0].querySelector('img')).toBeNull();
    const link = within(items[0]).getByRole('link', { name: 'https://app.frame.io/r/abc' });
    expect(link).toHaveAttribute('href', 'https://app.frame.io/r/abc');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
    expect(items[1]).toHaveTextContent('Former member');
  });

  it('never links a non-http scheme', async () => {
    db.listComments.mockResolvedValue([comment({ body: 'javascript:alert(1) and data:text/html,hi and ftp://x.y' })]);
    renderCollab();
    await screen.findByRole('list', { name: 'Comments' });
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders a mention as @Name and marks the one that is you', async () => {
    const ME = '99999999-9999-4999-8999-999999999999';
    const QC = '88888888-8888-4888-8888-888888888888';
    db.listComments.mockResolvedValue([comment({ body: `Hi @[Pat Person](${ME}) and @[Quinn QC](${QC})!` })]);
    renderWithAuth(<TaskCollaboration taskId={TASK} isAssignedEditor />, { auth: makeAuth('EDITOR', { user: { id: ME, email: 'pat@x.y' } }) });
    const list = await screen.findByRole('list', { name: 'Comments' });
    const mentions = list.querySelectorAll('[data-mention]');
    expect(Array.from(mentions).map((m) => m.textContent)).toEqual(['@Pat Person', '@Quinn QC']);
    expect(list).not.toHaveTextContent(ME);
    expect(mentions[0].className).toMatch(/bg-primary/);
  });

  it('posts at once, under the id it keeps, and empties the box', async () => {
    let resolve: (v: TaskComment) => void = () => undefined;
    db.addComment.mockReturnValue(new Promise<TaskComment>((r) => (resolve = r)));
    renderCollab();
    const box = await screen.findByLabelText('Write a comment');
    await userEvent.type(box, 'Looks good to me');
    await userEvent.click(screen.getByRole('button', { name: /Comment/ }));
    expect(db.addComment).toHaveBeenCalledWith(TASK, 'Looks good to me', expect.stringMatching(/^[0-9a-f-]{36}$/));
    // shown before the database answered, by the signed-in person
    const list = await screen.findByRole('list', { name: 'Comments' });
    expect(list).toHaveTextContent('Pat Person');
    expect(list).toHaveTextContent('Looks good to me');
    expect(box).toHaveValue('');
    const id = db.addComment.mock.calls[0][2] as string;
    resolve(comment({ id, authorId: PEOPLE.me, body: 'Looks good to me' }));
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Comments' })).getAllByRole('listitem')).toHaveLength(1));
  });

  it('Ctrl+Enter posts too', async () => {
    db.addComment.mockImplementation(async (_t: string, body: string, id: string) => comment({ id, authorId: PEOPLE.me, body }));
    renderCollab();
    const box = await screen.findByLabelText('Write a comment');
    await userEvent.type(box, 'Quick one');
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(db.addComment).toHaveBeenCalledTimes(1));
  });

  it('when the database refuses, the comment disappears and the text comes back with the reason', async () => {
    db.addComment.mockRejectedValue(new Error('You do not have permission to comment on this task.'));
    renderCollab();
    const box = await screen.findByLabelText('Write a comment');
    await userEvent.type(box, 'Important point');
    await userEvent.click(screen.getByRole('button', { name: /Comment/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission to comment on this task.');
    expect(box).toHaveValue('Important point');
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Comments' })).toBeNull());
    expect(screen.getByText('No comments yet')).toBeInTheDocument();
  });

  it('will not send an empty comment', async () => {
    renderCollab();
    await screen.findByLabelText('Write a comment');
    expect(screen.getByRole('button', { name: /Comment/ })).toBeDisabled();
  });

  describe('@mentions', () => {
    it('opens a list of the people who can be mentioned, filters it, and inserts a token the database can read', async () => {
      db.addComment.mockImplementation(async (_t: string, body: string, id: string) => comment({ id, authorId: PEOPLE.me, body }));
      renderCollab();
      const box = await screen.findByLabelText('Write a comment');
      await userEvent.type(box, 'Hi @qu');
      const listbox = await screen.findByRole('listbox', { name: 'People you can mention' });
      expect(within(listbox).getAllByRole('option')).toHaveLength(1);
      expect(within(listbox).getByRole('option')).toHaveTextContent('Quinn QC');
      await userEvent.keyboard('{Enter}');
      expect(box).toHaveValue(`Hi @[Quinn QC](${PEOPLE.qc}) `);
      expect(screen.queryByRole('listbox')).toBeNull();
      await userEvent.type(box, 'can you review?');
      await userEvent.click(screen.getByRole('button', { name: /Comment/ }));
      expect(db.addComment).toHaveBeenCalledWith(TASK, `Hi @[Quinn QC](${PEOPLE.qc}) can you review?`, expect.any(String));
    });

    it('lists everyone on "@", moves with the arrow keys, and closes with Escape', async () => {
      renderCollab();
      const box = await screen.findByLabelText('Write a comment');
      await userEvent.type(box, '@');
      const listbox = await screen.findByRole('listbox');
      const options = within(listbox).getAllByRole('option');
      expect(options.length).toBe(5);
      // yourself last
      expect(options[options.length - 1]).toHaveTextContent('Pat Person');
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
      await userEvent.keyboard('{ArrowDown}');
      expect(within(screen.getByRole('listbox')).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('picks with the mouse', async () => {
      renderCollab();
      const box = await screen.findByLabelText('Write a comment');
      await userEvent.type(box, 'ping @mia');
      await userEvent.click(await screen.findByRole('option', { name: /Mia Manager/ }));
      expect(box).toHaveValue(`ping @[Mia Manager](${PEOPLE.manager}) `);
    });

    it('does not open for an e-mail address', async () => {
      renderCollab();
      const box = await screen.findByLabelText('Write a comment');
      await userEvent.type(box, 'write to pat@example');
      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('offers nobody who is a client viewer or deactivated', async () => {
      db.getWorkspaceMembers.mockResolvedValue([
        ...MEMBERS,
        { ...MEMBERS[0], userId: 'client-1', role: 'CLIENT_VIEWER', profile: { ...MEMBERS[0].profile!, id: 'client-1', fullName: 'Cleo Client' } },
        { ...MEMBERS[0], userId: 'gone-1', profile: { ...MEMBERS[0].profile!, id: 'gone-1', fullName: 'Gus Gone', isActive: false } },
      ]);
      renderCollab();
      const box = await screen.findByLabelText('Write a comment');
      await userEvent.type(box, '@');
      const names = (await screen.findAllByRole('option')).map((o) => o.textContent);
      expect(names.join(' ')).not.toMatch(/Cleo|Gus/);
    });
  });

  describe('editing and deleting', () => {
    it('only the author can edit; the edit is saved and marked', async () => {
      let stored = [comment({ id: COMMENT_A, authorId: PEOPLE.me, body: 'First draft' }), comment({ id: COMMENT_B, authorId: PEOPLE.qc, body: 'Theirs' })];
      db.listComments.mockImplementation(async () => stored);
      db.editComment.mockImplementation(async (id: string, body: string) => {
        const saved = comment({ id, authorId: PEOPLE.me, body, editedAt: new Date().toISOString() });
        stored = stored.map((c) => (c.id === id ? saved : c));
        return saved;
      });
      renderCollab('EDITOR');
      await screen.findByText('First draft');
      // an editor has actions on their own comment only
      expect(screen.getAllByRole('button', { name: /Actions for the comment by/ })).toHaveLength(1);
      await userEvent.click(screen.getByRole('button', { name: 'Actions for the comment by Pat Person' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
      const box = await screen.findByLabelText('Edit comment');
      expect(box).toHaveValue('First draft');
      await userEvent.clear(box);
      await userEvent.type(box, 'Second draft');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(db.editComment).toHaveBeenCalledWith(COMMENT_A, 'Second draft');
      expect(await screen.findByText('Second draft')).toBeInTheDocument();
      expect(screen.getByText('(edited)')).toBeInTheDocument();
      expect(screen.queryByLabelText('Edit comment')).toBeNull();
    });

    it('cancelling an edit changes nothing', async () => {
      db.listComments.mockResolvedValue([comment({ authorId: PEOPLE.me, body: 'Keep me' })]);
      renderCollab();
      await screen.findByText('Keep me');
      await userEvent.click(screen.getByRole('button', { name: /Actions for the comment/ }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
      await userEvent.type(await screen.findByLabelText('Edit comment'), ' more');
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(db.editComment).not.toHaveBeenCalled();
      expect(screen.getByText('Keep me')).toBeInTheDocument();
    });

    it('a refused edit shows the reason and keeps the box open with the text', async () => {
      db.listComments.mockResolvedValue([comment({ authorId: PEOPLE.me, body: 'Original' })]);
      db.editComment.mockRejectedValue(new Error('You can only edit your own comments.'));
      renderCollab();
      await screen.findByText('Original');
      await userEvent.click(screen.getByRole('button', { name: /Actions for the comment/ }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
      const box = await screen.findByLabelText('Edit comment');
      await userEvent.type(box, '!');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('You can only edit your own comments.');
      expect(box).toHaveValue('Original!');
    });

    it('deleting your own asks first, then removes it at once', async () => {
      let stored = [comment({ authorId: PEOPLE.me, body: 'Oops' })];
      db.listComments.mockImplementation(async () => stored);
      db.deleteComment.mockImplementation(async () => {
        stored = [];
      });
      renderCollab();
      await screen.findByText('Oops');
      await userEvent.click(screen.getByRole('button', { name: /Actions for the comment/ }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      const confirm = await screen.findByRole('alertdialog');
      expect(confirm).toHaveTextContent('Delete this comment?');
      expect(db.deleteComment).not.toHaveBeenCalled();
      await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
      expect(db.deleteComment).toHaveBeenCalledWith(COMMENT_A);
      await waitFor(() => expect(screen.queryByText('Oops')).toBeNull());
    });

    it('a refused delete puts the comment back and says why', async () => {
      db.listComments.mockResolvedValue([comment({ authorId: PEOPLE.me, body: 'Stays' })]);
      db.deleteComment.mockRejectedValue(new Error('You can only delete your own comments.'));
      renderCollab();
      await screen.findByText('Stays');
      await userEvent.click(screen.getByRole('button', { name: /Actions for the comment/ }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('You can only delete your own comments.'));
      expect(await screen.findByText('Stays')).toBeInTheDocument();
    });

    it('an admin can delete anyone\'s comment but not edit it; a production manager can do neither', async () => {
      db.listComments.mockResolvedValue([comment({ authorId: PEOPLE.qc, body: 'By QC' })]);
      const admin = renderCollab('ADMIN');
      await screen.findByText('By QC');
      await userEvent.click(screen.getByRole('button', { name: /Actions for the comment by Quinn QC/ }));
      expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
      admin.unmount();
      renderCollab('PRODUCTION_MANAGER');
      await screen.findByText('By QC');
      expect(screen.queryByRole('button', { name: /Actions for the comment/ })).toBeNull();
    });
  });

  it('a link from a notification scrolls to the comment and marks it', async () => {
    db.listComments.mockResolvedValue([comment({ id: COMMENT_A }), comment({ id: COMMENT_B, body: 'The one' })]);
    renderCollab('EDITOR', { route: `/?tab=comments&comment=${COMMENT_B}` });
    await screen.findByText('The one');
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect(document.getElementById(`comment-${COMMENT_B}`)?.className).toMatch(/ring-primary/);
  });

  it('shows a retry when the comments cannot be loaded', async () => {
    db.listComments.mockRejectedValueOnce(new Error('Comments could not be fetched.'));
    renderCollab();
    expect(await screen.findByText('Comments could not be loaded')).toBeInTheDocument();
    db.listComments.mockResolvedValue([comment()]);
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByText('Please tighten the intro.')).toBeInTheDocument();
  });

  it('a client viewer sees no composer (the database gives clients no task access yet)', async () => {
    renderCollab('CLIENT_VIEWER');
    expect(await screen.findByText(/can read this conversation but not add to it/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Write a comment')).toBeNull();
  });
});

describe('files', () => {
  const openFiles = async (role: TbbRole = 'QC_SPECIALIST', assigned = false) => {
    const view = renderCollab(role, { route: '/?tab=files', assigned });
    await screen.findByRole('tabpanel', { name: /Files/ });
    return view;
  };
  const chooser = () => screen.getByLabelText('Choose files to attach') as HTMLInputElement;
  const pdf = (name = 'Script v3.pdf', size = 1024) => new File([new Uint8Array(size)], name, { type: 'application/pdf' });

  it('lists files with type, size, who and when', async () => {
    db.listAttachments.mockResolvedValue([file()]);
    await openFiles();
    const list = await screen.findByRole('list', { name: 'Attached files' });
    expect(list).toHaveTextContent('Script v2.pdf');
    expect(list).toHaveTextContent('PDF · 150 KB · Quinn QC');
    expect(screen.getByRole('tab', { name: /Files/ })).toHaveTextContent('1');
  });

  it('says so when there are none', async () => {
    await openFiles();
    expect(await screen.findByText('No files attached yet.')).toBeInTheDocument();
  });

  it('who may attach: managers, QC and the assigned editor; an unassigned editor only reads', async () => {
    (await openFiles('QC_SPECIALIST')).unmount();
    for (const [role, assigned, can] of [['PRODUCTION_MANAGER', false, true], ['EDITOR', true, true], ['EDITOR', false, false]] as const) {
      const v = await openFiles(role, assigned);
      if (can) expect(chooser()).toBeInTheDocument();
      else {
        expect(screen.queryByLabelText('Choose files to attach')).toBeNull();
        expect(screen.getByText(/Managers, QC and the assigned editor can attach files/)).toBeInTheDocument();
      }
      v.unmount();
    }
  });

  it('uploads with real progress, then lists the new file', async () => {
    let progress: (f: number) => void = () => undefined;
    let finish: (a: TaskAttachment) => void = () => undefined;
    db.uploadAttachment.mockImplementation(({ onProgress }: { onProgress: (f: number) => void }) => {
      progress = onProgress;
      return new Promise<TaskAttachment>((r) => (finish = r));
    });
    await openFiles();
    const f = pdf('Script v3.pdf');
    await userEvent.upload(chooser(), f);
    const uploads = await screen.findByRole('list', { name: 'Uploads' });
    expect(db.uploadAttachment).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-1', taskId: TASK, file: f }));
    expect(uploads).toHaveTextContent('Script v3.pdf');
    expect(within(uploads).getByRole('progressbar', { name: 'Uploading Script v3.pdf' })).toBeInTheDocument();
    progress(0.4);
    await waitFor(() => expect(uploads).toHaveTextContent('40%'));
    db.listAttachments.mockResolvedValue([file({ id: 'new', fileName: 'Script v3.pdf', uploadedBy: PEOPLE.qc })]);
    finish(file({ id: 'new', fileName: 'Script v3.pdf' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Uploads' })).toBeNull());
    expect(await screen.findByRole('list', { name: 'Attached files' })).toHaveTextContent('Script v3.pdf');
  });

  it('uploads several files at once, each with its own bar', async () => {
    db.uploadAttachment.mockReturnValue(new Promise(() => undefined));
    await openFiles();
    await userEvent.upload(chooser(), [pdf('a.pdf'), pdf('b.pdf')]);
    const uploads = await screen.findByRole('list', { name: 'Uploads' });
    expect(within(uploads).getAllByRole('progressbar')).toHaveLength(2);
    expect(db.uploadAttachment).toHaveBeenCalledTimes(2);
  });

  it('refuses an unsuitable or oversized file with the reason and without sending anything', async () => {
    await openFiles();
    await userEvent.upload(chooser(), new File(['x'], 'setup.exe', { type: 'application/x-msdownload' }), { applyAccept: false });
    const big = new File(['x'], 'huge.zip', { type: 'application/zip' });
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    await userEvent.upload(chooser(), big);
    const alerts = await screen.findAllByRole('alert');
    expect(alerts[0]).toHaveTextContent('cannot be attached');
    expect(alerts[1]).toHaveTextContent('at most 25 MB');
    expect(db.uploadAttachment).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss setup.exe' }));
    expect(screen.queryByText(/setup\.exe/)).toBeNull();
  });

  it('shows the storage refusal on the file and lets it be dismissed', async () => {
    db.uploadAttachment.mockRejectedValue(new Error('You do not have permission to attach files to this task.'));
    await openFiles();
    await userEvent.upload(chooser(), pdf());
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission to attach files to this task.');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss Script v3.pdf' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a cancelled upload leaves no trace', async () => {
    db.uploadAttachment.mockImplementation(({ signal }: { signal: AbortSignal }) =>
      new Promise((_r, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'ABORTED' }))))
    );
    await openFiles();
    await userEvent.upload(chooser(), pdf());
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel upload of Script v3.pdf' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Uploads' })).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('opens a file through a short-lived link, in a new window', async () => {
    db.listAttachments.mockResolvedValue([file()]);
    db.getAttachmentUrl.mockResolvedValue('https://signed.example/file');
    const popup = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    await openFiles();
    await userEvent.click(await screen.findByRole('button', { name: 'Open Script v2.pdf' }));
    await waitFor(() => expect(popup.location.href).toBe('https://signed.example/file'));
    expect(db.getAttachmentUrl).toHaveBeenCalledWith(expect.objectContaining({ storagePath: 'ws/task/att-1/Script-v2.pdf' }), { download: false });
    expect(popup.opener).toBeNull();
    open.mockRestore();
  });

  it('downloads under the file\'s own name', async () => {
    db.listAttachments.mockResolvedValue([file()]);
    db.getAttachmentUrl.mockResolvedValue('https://signed.example/file');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await openFiles();
    await userEvent.click(await screen.findByRole('button', { name: 'Download Script v2.pdf' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(db.getAttachmentUrl).toHaveBeenCalledWith(expect.anything(), { download: true });
    click.mockRestore();
  });

  it('closes the blank window and says why when the link cannot be made', async () => {
    db.listAttachments.mockResolvedValue([file()]);
    db.getAttachmentUrl.mockRejectedValue(new Error('The file could not be opened. It may have been removed.'));
    const popup = { close: vi.fn(), location: { href: '' }, opener: null };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    await openFiles();
    await userEvent.click(await screen.findByRole('button', { name: 'Open Script v2.pdf' }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('The file could not be opened. It may have been removed.'));
    expect(popup.close).toHaveBeenCalled();
  });

  it('removal: the uploader and managers can; others cannot; it asks first and is optimistic with rollback', async () => {
    db.listAttachments.mockResolvedValue([file({ id: 'mine', uploadedBy: PEOPLE.me, fileName: 'Mine.pdf' }), file({ id: 'theirs', uploadedBy: PEOPLE.qc, fileName: 'Theirs.pdf' })]);
    db.deleteAttachment.mockRejectedValueOnce(new Error('Only the person who attached a file, or a manager, can remove it.')).mockResolvedValue(undefined);
    const editor = await openFiles('EDITOR', true);
    expect(screen.getByRole('button', { name: 'Remove Mine.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Theirs.pdf' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Mine.pdf' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(db.deleteAttachment).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    // refused: it comes back, with the reason
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Only the person who attached a file, or a manager, can remove it.'));
    expect(await screen.findByText('Mine.pdf')).toBeInTheDocument();
    editor.unmount();
    await openFiles('PRODUCTION_MANAGER');
    expect(await screen.findByRole('button', { name: 'Remove Theirs.pdf' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Theirs.pdf' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    expect(db.deleteAttachment).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'theirs' }));
  });
});

describe('activity', () => {
  const entries: ActivityEntry[] = [
    { source: 'activity', id: 'a3', taskId: TASK, actorId: PEOPLE.qc, createdAt: new Date(Date.now() - 60_000).toISOString(), kind: 'commented', data: { comment_id: COMMENT_A } },
    {
      source: 'status', id: 's1', taskId: TASK, actorId: PEOPLE.qc, createdAt: new Date(Date.now() - 3600_000).toISOString(),
      event: { id: 's1', taskId: TASK, from: 'QC_FIRST_APPROVAL', to: 'QC_REVISION_NEEDED', actorId: PEOPLE.qc, note: 'Tighten the intro', isOverride: false, revisionNumber: 1, createdAt: new Date(Date.now() - 3600_000).toISOString() },
    },
    { source: 'activity', id: 'a1', taskId: TASK, actorId: PEOPLE.manager, createdAt: new Date(Date.now() - 86_400_000).toISOString(), kind: 'assigned', data: { role_type: 'EDITOR', user_id: PEOPLE.me } },
  ];

  it('shows what happened, who did it and when, from the stored rows', async () => {
    db.listTaskActivity.mockResolvedValue({ entries, hasMore: false });
    renderCollab('EDITOR', { route: '/?tab=activity' });
    const list = await screen.findByRole('list', { name: 'Activity' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Quinn QC commented');
    expect(items[1]).toHaveTextContent('Quinn QC moved the task from QC - FIRST APPROVAL to QC - REVISION NEEDED · revision 1');
    expect(items[1]).toHaveTextContent('Tighten the intro');
    expect(items[2]).toHaveTextContent('Mia Manager assigned Pat Person as editor');
    expect(db.listTaskActivity).toHaveBeenCalledWith(TASK, 50);
  });

  it('says plainly when nothing has happened (no invented history)', async () => {
    renderCollab('EDITOR', { route: '/?tab=activity' });
    expect(await screen.findByText('Nothing has happened to this task yet.')).toBeInTheDocument();
  });

  it('"view" on a comment jumps to it in the comments tab', async () => {
    db.listTaskActivity.mockResolvedValue({ entries, hasMore: false });
    db.listComments.mockResolvedValue([comment({ id: COMMENT_A })]);
    renderCollab('EDITOR', { route: '/?tab=activity' });
    await userEvent.click(await screen.findByRole('button', { name: 'view' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`tab=comments&comment=${COMMENT_A}`));
    expect(await screen.findByText('Please tighten the intro.')).toBeInTheDocument();
  });

  it('loads older activity on request', async () => {
    db.listTaskActivity.mockResolvedValueOnce({ entries, hasMore: true }).mockResolvedValue({ entries, hasMore: false });
    renderCollab('EDITOR', { route: '/?tab=activity' });
    await userEvent.click(await screen.findByRole('button', { name: 'Show older activity' }));
    await waitFor(() => expect(db.listTaskActivity).toHaveBeenLastCalledWith(TASK, 100));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show older activity' })).toBeNull());
  });
});

describe('tabs live in the address', () => {
  it('comments are the default; choosing a tab writes it to the URL and leaving comments drops the linked comment', async () => {
    renderCollab('EDITOR', { route: `/?comment=${COMMENT_A}` });
    expect(await screen.findByRole('tab', { name: /Comments/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: /Files/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/?tab=files');
    expect(screen.getByTestId('where')).not.toHaveTextContent('comment=');
    await userEvent.click(screen.getByRole('tab', { name: /Activity/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/?tab=activity');
  });

  it('an unknown tab in the address falls back to comments', async () => {
    renderCollab('EDITOR', { route: '/?tab=nonsense' });
    expect(await screen.findByRole('tab', { name: /Comments/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('counts show on the tabs once loaded', async () => {
    db.listComments.mockResolvedValue([comment(), comment({ id: COMMENT_B })]);
    db.listAttachments.mockResolvedValue([file()]);
    renderCollab();
    await waitFor(() => expect(screen.getByRole('tab', { name: /Comments/ })).toHaveTextContent('2'));
    expect(screen.getByRole('tab', { name: /Files/ })).toHaveTextContent('1');
  });
});

describe('notification centre', () => {
  const note = (n: number, over: Partial<AppNotification> = {}): AppNotification => ({
    id: `n${n}`, userId: PEOPLE.me, workspaceId: 'ws-1', taskId: TASK, actorId: PEOPLE.qc, kind: 'mention',
    data: { title: 'Founder story', snippet: 'Can you check the intro?', comment_id: COMMENT_A }, readAt: null, archivedAt: null,
    createdAt: new Date(Date.now() - n * 60_000).toISOString(), ...over,
  });
  const renderBell = (role: TbbRole = 'EDITOR') => renderWithAuth(<><NotificationBell /><Where /></>, { auth: makeAuth(role), route: '/home' });

  it('shows the unread count on the bell, and says it in the label', async () => {
    db.countUnreadNotifications.mockResolvedValue(3);
    renderBell();
    expect(await screen.findByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument();
    expect(screen.getByTestId('unread-badge')).toHaveTextContent('3');
  });

  it('no badge when nothing is unread; 99+ when there are very many', async () => {
    renderBell();
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByTestId('unread-badge')).toBeNull();
    db.countUnreadNotifications.mockResolvedValue(250);
    renderBell();
    await waitFor(() => expect(screen.getAllByTestId('unread-badge').pop()).toHaveTextContent('99+'));
  });

  it('subscribes for this person while mounted, and stops after', async () => {
    const stop = vi.fn();
    db.subscribeToNotifications.mockReturnValue(stop);
    const view = renderBell();
    await waitFor(() => expect(db.subscribeToNotifications).toHaveBeenCalledWith(PEOPLE.me, expect.any(Function), expect.any(Function)));
    view.unmount();
    expect(stop).toHaveBeenCalled();
  });

  it('a live change refreshes the count and the list', async () => {
    let live: () => void = () => undefined;
    (db.subscribeToNotifications as ReturnType<typeof vi.fn>).mockImplementation((_u: string, cb: () => void) => {
      live = cb;
      return () => undefined;
    });
    renderBell();
    await waitFor(() => expect(db.countUnreadNotifications).toHaveBeenCalledTimes(1));
    db.countUnreadNotifications.mockResolvedValue(1);
    live();
    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument();
  });

  it('lists real notifications with who, what and when, unread first in appearance', async () => {
    db.countUnreadNotifications.mockResolvedValue(2);
    db.listNotifications.mockResolvedValue({
      items: [note(1), note(2, { kind: 'assigned', data: { title: 'Podcast clip', role_type: 'EDITOR' }, readAt: '2026-10-05T10:00:00Z' })],
      next: null,
    });
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    const list = await screen.findByRole('list', { name: 'Notifications' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Quinn QC mentioned you');
    expect(items[0]).toHaveTextContent('Founder story · “Can you check the intro?”');
    expect(items[0]).toHaveTextContent('(unread)');
    expect(items[1]).toHaveTextContent('Quinn QC assigned you as editor');
    expect(items[1]).not.toHaveTextContent('(unread)');
  });

  it('opening one marks it read and goes straight to the comment', async () => {
    let unread = 1;
    db.countUnreadNotifications.mockImplementation(async () => unread);
    db.markNotificationsRead.mockImplementation(async () => {
      unread = 0;
    });
    db.listNotifications.mockResolvedValue({ items: [note(1)], next: null });
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Quinn QC mentioned you/ }));
    expect(db.markNotificationsRead).toHaveBeenCalledWith(['n1']);
    expect(screen.getByTestId('where')).toHaveTextContent(`/tasks/${TASK}?tab=comments&comment=${COMMENT_A}`);
    // the badge dropped at once
    await waitFor(() => expect(screen.queryByTestId('unread-badge')).toBeNull());
  });

  it('opening one that is already read does not write anything', async () => {
    db.listNotifications.mockResolvedValue({ items: [note(1, { readAt: '2026-10-05T10:00:00Z' })], next: null });
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Quinn QC mentioned you/ }));
    expect(db.markNotificationsRead).not.toHaveBeenCalled();
  });

  it('mark all read empties the badge at once', async () => {
    let unread = 2;
    db.countUnreadNotifications.mockImplementation(async () => unread);
    db.markAllNotificationsRead.mockImplementation(async () => {
      unread = 0;
    });
    db.listNotifications.mockResolvedValue({ items: [note(1), note(2)], next: null });
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /Notifications, 2 unread/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    expect(db.markAllNotificationsRead).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('unread-badge')).toBeNull());
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
  });

  it('a failed mark-read puts the count and the row back, and says so', async () => {
    db.countUnreadNotifications.mockResolvedValue(1);
    db.listNotifications.mockResolvedValue({ items: [note(1)], next: null });
    db.markAllNotificationsRead.mockRejectedValue(new Error('Could not mark notifications as read.'));
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /Notifications, 1 unread/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Could not mark notifications as read.'));
    await waitFor(() => expect(screen.getByTestId('unread-badge')).toHaveTextContent('1'));
  });

  it('marks one as read or unread from its menu', async () => {
    db.countUnreadNotifications.mockResolvedValue(1);
    db.listNotifications.mockResolvedValue({ items: [note(1), note(2, { readAt: '2026-10-05T10:00:00Z' })], next: null });
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /Notifications, 1 unread/ }));
    const menus = await screen.findAllByRole('button', { name: 'Notification actions' });
    await userEvent.click(menus[1]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark as unread' }));
    expect(db.markNotificationUnread).toHaveBeenCalledWith('n2');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Notification actions' }))[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark as read' }));
    expect(db.markNotificationsRead).toHaveBeenCalledWith(['n1']);
  });

  it('filters to unread and explains an empty result', async () => {
    db.countUnreadNotifications.mockResolvedValue(0);
    db.listNotifications.mockResolvedValue({ items: [note(1, { readAt: '2026-10-05T10:00:00Z' })], next: null });
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    await screen.findByRole('list', { name: 'Notifications' });
    await userEvent.click(screen.getByRole('button', { name: 'Unread' }));
    expect(await screen.findByText('No unread notifications.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findByRole('list', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('is honest when there is nothing', async () => {
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    expect(await screen.findByText(/You're all caught up/)).toBeInTheDocument();
  });

  it('pages older notifications with the cursor the database gave', async () => {
    db.listNotifications
      .mockResolvedValueOnce({ items: [note(1)], next: { createdAt: 'T1', id: 'n1' } })
      .mockResolvedValue({ items: [note(2, { kind: 'comment', data: { title: 'Older task' } })], next: null });
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Load older' }));
    await waitFor(() => expect(db.listNotifications).toHaveBeenLastCalledWith({ before: { createdAt: 'T1', id: 'n1' } }));
    expect(await screen.findByText(/Quinn QC commented/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
  });

  it('shows an error with a retry', async () => {
    db.listNotifications.mockRejectedValueOnce(new Error('Could not load your notifications.'));
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your notifications.');
    db.listNotifications.mockResolvedValue({ items: [note(1)], next: null });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Quinn QC mentioned you/)).toBeInTheDocument();
  });

  it('a client viewer never queries or subscribes (no task access)', async () => {
    renderBell('CLIENT_VIEWER');
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText(/for the production team/)).toBeInTheDocument();
    expect(db.countUnreadNotifications).not.toHaveBeenCalled();
    expect(db.listNotifications).not.toHaveBeenCalled();
    expect(db.subscribeToNotifications).not.toHaveBeenCalled();
  });
});

describe('what these screens never do', () => {
  it('create fixtures: nothing is written unless a person acts', async () => {
    renderCollab();
    await screen.findByText('No comments yet');
    for (const fn of ['addComment', 'editComment', 'deleteComment', 'uploadAttachment', 'deleteAttachment', 'markNotificationsRead', 'markAllNotificationsRead'] as const) {
      expect(db[fn]).not.toHaveBeenCalled();
    }
    // the IDs fixture is used only to build the hierarchy
    expect(IDS.spaceA).toBeTruthy();
  });
});

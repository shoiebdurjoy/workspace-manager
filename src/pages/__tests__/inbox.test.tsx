import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import InboxPage from '@/pages/InboxPage';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { TooltipProvider } from '@/components/ui/tooltip';
import { makeAuth, renderWithAuth } from '@/test/auth-utils';
import type { createDatabaseMock } from '@/test/database-mock';
import * as dbModule from '@/database';
import { MEMBERS, PEOPLE } from '@/test/task-fixtures';
import { TBB_WORKFLOW } from '@/test/workflow-fixture';
import type { AppNotification, TbbRole } from '@/types/database';

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

const TASK = '44444444-4444-4444-8444-444444444444';
const COMMENT = '55555555-5555-4555-8555-555555555555';

const Where: React.FC = () => {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
};
const routes = (
  <TooltipProvider>
    <Routes>
      <Route
        path="/inbox"
        element={
          <ProtectedRoute capability="comments:view-internal">
            <InboxPage />
          </ProtectedRoute>
        }
      />
      <Route path="/tasks/:taskId" element={<p>task page</p>} />
      <Route path="/unauthorized" element={<p>unauthorized</p>} />
    </Routes>
    <Where />
  </TooltipProvider>
);
const open = (role: TbbRole = 'EDITOR', route = '/inbox') => renderWithAuth(routes, { auth: makeAuth(role), route });

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const note = (id: string, over: Partial<AppNotification> = {}): AppNotification => ({
  id,
  userId: PEOPLE.me,
  workspaceId: 'ws-1',
  taskId: TASK,
  actorId: PEOPLE.qc,
  kind: 'mention',
  data: { title: 'Founder story', snippet: 'Check the intro', comment_id: COMMENT },
  readAt: null,
  archivedAt: null,
  createdAt: hoursAgo(1),
  ...over,
});

let rows: AppNotification[] = [];
const lastQuery = () => db.listNotifications.mock.calls.at(-1)?.[0] as { view?: string; kinds?: string[]; unreadOnly?: boolean };
const rowOf = (text: RegExp) => screen.getByText(text).closest('li') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  rows = [
    note('n1', { kind: 'mention', createdAt: hoursAgo(1) }),
    note('n2', { kind: 'assigned', data: { title: 'Conor reel', role_type: 'EDITOR' }, readAt: hoursAgo(2), createdAt: hoursAgo(3) }),
    note('n3', { kind: 'comment', data: { title: 'Old one', snippet: 'earlier' }, createdAt: hoursAgo(24 * 10) }),
    note('n4', { kind: 'status', data: { title: 'Done task', to: 'CLOSED' }, archivedAt: hoursAgo(1), readAt: hoursAgo(2), createdAt: hoursAgo(5) }),
  ];
  db.getWorkspaceMembers.mockResolvedValue(MEMBERS);
  db.getWorkflow.mockResolvedValue(TBB_WORKFLOW);
  // the stand-in database remembers Done, as the real one does (a refetch must not bring a row back)
  db.setNotificationsDone.mockImplementation(async (ids: readonly string[], done: boolean) => {
    rows = rows.map((n) => (ids.includes(n.id) ? { ...n, archivedAt: done ? new Date().toISOString() : null } : n));
  });
  db.listNotifications.mockImplementation(async (q: { view?: string; kinds?: string[]; unreadOnly?: boolean }) => ({
    items: rows.filter(
      (n) =>
        (q.view === 'inbox' ? n.archivedAt === null : q.view === 'done' ? n.archivedAt !== null : true) &&
        (!q.kinds?.length || q.kinds.includes(n.kind)) &&
        (!q.unreadOnly || n.readAt === null)
    ),
    next: null,
  }));
});

describe('Inbox', () => {
  it('shows what is not Done, newest first, grouped by day, with unread marked', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Inbox', level: 1 })).toBeInTheDocument();
    await screen.findByText(/mentioned you/);
    expect(lastQuery()).toMatchObject({ view: 'inbox', kinds: [], unreadOnly: false });
    expect(screen.getByRole('list', { name: 'Older' })).toHaveTextContent('Old one');
    expect(screen.queryByText(/Done task/)).not.toBeInTheDocument();
    expect(within(rowOf(/mentioned you/)).getByText('(unread)')).toBeInTheDocument();
    expect(within(rowOf(/assigned you as editor/i)).queryByText('(unread)')).not.toBeInTheDocument();
  });

  it('Done takes a notification out of the Inbox at once, and the database is told', async () => {
    open();
    await screen.findByText(/mentioned you/);
    await userEvent.click(within(rowOf(/mentioned you/)).getByRole('button', { name: 'Mark as Done' }));
    expect(db.setNotificationsDone).toHaveBeenCalledWith(['n1'], true);
    await waitFor(() => expect(screen.queryByText(/mentioned you/)).not.toBeInTheDocument());
  });

  it('puts a refused Done back and says why', async () => {
    db.setNotificationsDone.mockRejectedValueOnce(new Error('You cannot change that notification.'));
    open();
    await screen.findByText(/mentioned you/);
    await userEvent.click(within(rowOf(/mentioned you/)).getByRole('button', { name: 'Mark as Done' }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('You cannot change that notification.'));
    expect(await screen.findByText(/mentioned you/)).toBeInTheDocument();
  });

  it('the Done tab lists Done notifications and can move one back', async () => {
    open();
    await screen.findByText(/mentioned you/);
    await userEvent.click(screen.getByRole('tab', { name: 'Done' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/inbox?tab=done');
    await screen.findByText(/Done task/);
    expect(lastQuery()).toMatchObject({ view: 'done' });
    expect(screen.getByRole('tab', { name: 'Done' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(within(rowOf(/Done task/)).getByRole('button', { name: 'Move back to Inbox' }));
    expect(db.setNotificationsDone).toHaveBeenCalledWith(['n4'], false);
  });

  it('All shows both, labelling the Done ones', async () => {
    open('EDITOR', '/inbox?tab=all');
    await screen.findByText(/Done task/);
    expect(lastQuery()).toMatchObject({ view: 'all' });
    expect(within(rowOf(/Done task/)).getByText('Done')).toBeInTheDocument();
    expect(screen.getByText(/mentioned you/)).toBeInTheDocument();
  });

  it('filters by kind and unread, in the database and in the address', async () => {
    open();
    await screen.findByText(/mentioned you/);
    await userEvent.click(screen.getByRole('button', { name: 'Assignments' }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ kinds: ['assigned'] }));
    expect(screen.getByTestId('where')).toHaveTextContent('kind=assigned');
    await waitFor(() => expect(screen.queryByText(/mentioned you/)).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Unread only' }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ kinds: ['assigned'], unreadOnly: true }));
    expect(await screen.findByText('No notifications match these filters.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText(/mentioned you/)).toBeInTheDocument();
  });

  it('opening one marks it read and goes to the comment it is about', async () => {
    open();
    await userEvent.click(await screen.findByText(/mentioned you/));
    expect(db.markNotificationsRead).toHaveBeenCalledWith(['n1']);
    expect(screen.getByTestId('where')).toHaveTextContent(`/tasks/${TASK}?tab=comments&comment=${COMMENT}`);
  });

  it('works from the keyboard: j / k move, u toggles read, e marks Done, Enter opens', async () => {
    open();
    await screen.findByText(/mentioned you/);
    await userEvent.keyboard('j');
    expect(rowOf(/mentioned you/)).toHaveAttribute('aria-current', 'true');
    await userEvent.keyboard('u');
    expect(db.markNotificationsRead).toHaveBeenCalledWith(['n1']);
    await userEvent.keyboard('j');
    expect(rowOf(/assigned you as editor/i)).toHaveAttribute('aria-current', 'true');
    await userEvent.keyboard('u');
    expect(db.markNotificationUnread).toHaveBeenCalledWith('n2');
    await userEvent.keyboard('k');
    await userEvent.keyboard('e');
    expect(db.setNotificationsDone).toHaveBeenCalledWith(['n1'], true);
    // the next row takes its place
    await waitFor(() => expect(rowOf(/assigned you as editor/i)).toHaveAttribute('aria-current', 'true'));
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('where')).toHaveTextContent(`/tasks/${TASK}?tab=activity`);
  });

  it('marks all read, and clears read ones out of the Inbox', async () => {
    open();
    await screen.findByText(/mentioned you/);
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(db.markAllNotificationsRead).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Clear read' }));
    expect(db.markReadNotificationsDone).toHaveBeenCalled();
  });

  it('says plainly when the Inbox is empty', async () => {
    rows = [];
    open();
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
  });

  it('shows a load error with a retry', async () => {
    db.listNotifications.mockRejectedValue(new Error('The server could not be reached.'));
    open();
    expect(await screen.findByText('The server could not be reached.')).toBeInTheDocument();
  });

  it('is for the production team: a client viewer is sent away', async () => {
    open('CLIENT_VIEWER');
    expect(await screen.findByText('unauthorized')).toBeInTheDocument();
    expect(db.listNotifications).not.toHaveBeenCalled();
  });
});

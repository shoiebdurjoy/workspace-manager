import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import Home from '../Home';
import { makeAuth, makeProfile, renderWithAuth } from '@/test/auth-utils';
import type { createDatabaseMock } from '@/test/database-mock';
import * as dbModule from '@/database';
import { MEMBERS, PEOPLE, TASK_IDS, makeSummary } from '@/test/task-fixtures';
import { TBB_WORKFLOW } from '@/test/workflow-fixture';
import { fakeSearch } from '@/test/fake-search';
import type { HomeSummary } from '@/database';
import type { AppNotification, TbbRole } from '@/types/database';

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const queueItem = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Task ${id}`,
  listId: 'l1',
  listName: 'Edaptx',
  status: 'QC_FIRST_APPROVAL',
  statusName: 'QC - FIRST APPROVAL',
  qcId: PEOPLE.qc,
  editorId: PEOPLE.me,
  revisionCount: 0,
  since: hoursAgo(5),
  ...over,
});
const SUMMARY: HomeSummary = {
  role: 'PRODUCTION_MANAGER',
  mine: { total: 7, overdue: 2, dueToday: 1, dueThisWeek: 3, later: 1, finished: 4 },
  qcQueue: [queueItem('q1', { title: 'Walmart hook test' }), queueItem('q2', { title: 'Conor reel', qcId: null })],
  revisions: [queueItem('r1', { title: 'Founder story', status: 'QC_REVISION_NEEDED', revisionCount: 2 })],
  manager: { open: 40, overdue: 6, noEditor: 3, noQc: 5 },
};
const NOTE: AppNotification = {
  id: 'n1',
  userId: PEOPLE.me,
  workspaceId: 'ws-1',
  taskId: TASK_IDS.one,
  actorId: PEOPLE.qc,
  kind: 'mention',
  data: { title: 'Founder story', snippet: 'Check the intro' },
  readAt: null,
  archivedAt: null,
  createdAt: hoursAgo(1),
};

const renderHome = (role: TbbRole) =>
  renderWithAuth(<Home />, { auth: makeAuth(role, { profile: makeProfile({ fullName: 'Pat Person' }) }) });
const stat = (label: string) => screen.getByText(label).previousElementSibling as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  db.getWorkspaceMembers.mockResolvedValue(MEMBERS);
  db.listInvitations.mockResolvedValue([]);
  db.listTeams.mockResolvedValue([]);
  db.getWorkspaceHierarchy.mockResolvedValue([]);
  db.getWorkflow.mockResolvedValue(TBB_WORKFLOW);
  db.getHomeSummary.mockResolvedValue(SUMMARY);
  db.listNotifications.mockResolvedValue({ items: [NOTE], next: null });
  db.searchTasks.mockImplementation(
    fakeSearch(() => [
      makeSummary({ id: TASK_IDS.one, title: 'Walmart hook test', status: 'ASSIGNED', editorId: PEOPLE.me, updatedAt: hoursAgo(2) }),
      makeSummary({ id: TASK_IDS.two, title: 'Conor intro reel', status: 'QC_FIRST_APPROVAL', editorId: PEOPLE.me, qcId: PEOPLE.qc, updatedAt: hoursAgo(30) }),
    ])
  );
});

describe('Home: the personal hub', () => {
  it('asks the database for the summary with the viewer\'s own day boundaries', async () => {
    renderHome('EDITOR');
    await waitFor(() => expect(db.getHomeSummary).toHaveBeenCalled());
    const [ws, bounds] = db.getHomeSummary.mock.calls[0];
    expect(ws).toBe('ws-1');
    const { dayStart, dayEnd, weekEnd } = bounds as { dayStart: Date; dayEnd: Date; weekEnd: Date };
    expect(dayStart.getHours()).toBe(0);
    expect(dayEnd.getTime() - dayStart.getTime()).toBeGreaterThanOrEqual(23 * 3600_000);
    expect(Math.round((weekEnd.getTime() - dayEnd.getTime()) / 86_400_000)).toBe(7);
  });

  it('shows my own numbers from the database, each linking to My Tasks', async () => {
    renderHome('EDITOR');
    const region = await screen.findByRole('region', { name: 'My work' });
    await waitFor(() => expect(within(region).getByText('Overdue').previousElementSibling).toHaveTextContent('2'));
    expect(within(region).getByText('Due today').previousElementSibling).toHaveTextContent('1');
    expect(within(region).getByText('Next 7 days').previousElementSibling).toHaveTextContent('3');
    // the editor can start the ASSIGNED task: one task needs them
    await waitFor(() => expect(within(region).getByText('Needs my action').previousElementSibling).toHaveTextContent('1'));
    expect(within(region).getAllByRole('link').every((l) => l.getAttribute('href') === '/my-tasks')).toBe(true);
  });

  it('lists unread notifications and recently updated tasks, as links', async () => {
    renderHome('EDITOR');
    const notes = await screen.findByRole('region', { name: 'Unread notifications' });
    expect(await within(notes).findByText(/mentioned you/)).toBeInTheDocument();
    expect(within(notes).getByRole('link', { name: /mentioned you/ })).toHaveAttribute('href', expect.stringContaining(`/tasks/${TASK_IDS.one}`));
    const recent = screen.getByRole('region', { name: 'Recently updated, assigned to me' });
    expect(await within(recent).findByRole('link', { name: /Walmart hook test/ })).toHaveAttribute('href', `/my-tasks/tasks/${TASK_IDS.one}`);
  });

  it('an editor gets no QC queue and no workspace-wide numbers', async () => {
    db.getHomeSummary.mockResolvedValue({ ...SUMMARY, role: 'EDITOR', qcQueue: [], revisions: [], manager: null });
    renderHome('EDITOR');
    await screen.findByRole('region', { name: 'My work' });
    await waitFor(() => expect(db.getHomeSummary).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Waiting for QC' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'My QC queue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Across the workspace' })).not.toBeInTheDocument();
  });

  it('a QC specialist sees their own queue and revisions, not workspace numbers', async () => {
    db.getHomeSummary.mockResolvedValue({ ...SUMMARY, role: 'QC_SPECIALIST', manager: null });
    renderHome('QC_SPECIALIST');
    const queue = await screen.findByRole('region', { name: 'My QC queue' });
    expect(await within(queue).findByRole('link', { name: /Walmart hook test/ })).toHaveAttribute('href', `/tasks/q1`);
    expect(within(queue).getAllByText(/^since/).length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Revisions in progress' })).toHaveTextContent('revision 2');
    expect(screen.queryByRole('region', { name: 'Across the workspace' })).not.toBeInTheDocument();
  });

  it('a production manager sees every queue entry with its reviewer, and workspace numbers linking to Everything', async () => {
    renderHome('PRODUCTION_MANAGER');
    const queue = await screen.findByRole('region', { name: 'Waiting for QC' });
    expect(await within(queue).findByText(/No QC reviewer/)).toBeInTheDocument();
    const wide = screen.getByRole('region', { name: 'Across the workspace' });
    await waitFor(() => expect(within(wide).getByText('Open tasks').previousElementSibling).toHaveTextContent('40'));
    expect(within(wide).getByText('No editor').previousElementSibling).toHaveTextContent('3');
    expect(within(wide).getByText('No QC reviewer').previousElementSibling).toHaveTextContent('5');
    expect(within(wide).getByRole('link', { name: /Overdue/ })).toHaveAttribute('href', '/everything?overdue=1&hide=1');
    expect(within(wide).getByRole('link', { name: /No editor/ })).toHaveAttribute('href', '/everything?editor=none&hide=1');
  });

  it('says so, with a retry, when the summary cannot be loaded', async () => {
    db.getHomeSummary.mockRejectedValue(new Error('The server could not be reached.'));
    renderHome('EDITOR');
    expect(await screen.findByText(/Your summary could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows plain empty states, never invented items', async () => {
    db.listNotifications.mockResolvedValue({ items: [], next: null });
    db.searchTasks.mockImplementation(fakeSearch(() => []));
    db.getHomeSummary.mockResolvedValue({ ...SUMMARY, qcQueue: [], revisions: [] });
    renderHome('PRODUCTION_MANAGER');
    expect(await screen.findByText('You are all caught up.')).toBeInTheDocument();
    expect(await screen.findByText('Nothing assigned to you yet.')).toBeInTheDocument();
    expect(await screen.findByText('Nothing is waiting for QC.')).toBeInTheDocument();
    expect(screen.getByText('No cuts are back with editors.')).toBeInTheDocument();
    expect(stat('Open tasks')).toBeInTheDocument();
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CalendarPage from '@/pages/CalendarPage';
import WorkloadPage from '@/pages/WorkloadPage';
import { makeAuth, renderWithAuth } from '@/test/auth-utils';
import type { createDatabaseMock } from '@/test/database-mock';
import * as dbModule from '@/database';
import { isoForDay, dayKey } from '@/lib/calendar';
import { MEMBERS, PEOPLE, TASK_IDS, makeSummary } from '@/test/task-fixtures';
import { fakeSearch } from '@/test/fake-search';
import { TBB_WORKFLOW } from '@/test/workflow-fixture';
import type { TbbRole } from '@/types/database';

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

const today = new Date();
const inMonth = (day: number) => dayKey(new Date(today.getFullYear(), today.getMonth(), day));
const ROWS = [
  makeSummary({ id: TASK_IDS.one, title: 'Walmart hook test', status: 'STARTED_EDITING', editorId: PEOPLE.me, qcId: null, dueDate: isoForDay(inMonth(10)), clientDeadline: isoForDay(inMonth(12)) }),
  makeSummary({ id: TASK_IDS.two, title: 'Conor intro reel', status: 'QC_FIRST_APPROVAL', editorId: PEOPLE.me, qcId: PEOPLE.qc, dueDate: isoForDay(inMonth(10)) }),
  makeSummary({ id: TASK_IDS.three, title: 'Nobody yet', status: 'TO_BE_EDITED', editorId: null }),
];

beforeEach(() => {
  vi.clearAllMocks();
  db.getWorkspaceMembers.mockResolvedValue(MEMBERS);
  db.getWorkflow.mockResolvedValue(TBB_WORKFLOW);
  db.searchTasks.mockImplementation(fakeSearch(() => ROWS));
  db.listAvailability.mockResolvedValue(new Map());
  db.updateTask.mockResolvedValue(undefined);
});

const open = (ui: React.ReactElement, role: TbbRole = 'PRODUCTION_MANAGER') => renderWithAuth(ui, { auth: makeAuth(role) });

describe('Calendar', () => {
  it('shows both deadlines of each open task on their days, asking only for open work', async () => {
    open(<CalendarPage />);
    await screen.findAllByRole('link', { name: /Walmart hook test/ });
    expect(screen.getAllByRole('link', { name: /Walmart hook test/ })).toHaveLength(2); // QC due and client deadline
    expect(screen.getAllByRole('link', { name: /Conor intro reel/ })).toHaveLength(1);
    expect(screen.queryByText('Nobody yet')).not.toBeInTheDocument(); // no dates: not on a calendar
    expect(db.searchTasks.mock.calls[0][1]).toMatchObject({ filters: { hideFinished: true } });
  });

  it('moves between months', async () => {
    open(<CalendarPage />);
    await screen.findAllByRole('link', { name: /Walmart hook test/ });
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.queryByRole('link', { name: /Walmart hook test/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect((await screen.findAllByRole('link', { name: /Walmart hook test/ })).length).toBe(2);
  });

  it('a manager drags a QC due chip to another day and only that date changes', async () => {
    open(<CalendarPage />);
    const chips = await screen.findAllByRole('link', { name: /Walmart hook test/ });
    const qcChip = chips.find((c) => c.getAttribute('title')?.includes('QC due'))!;
    const target = screen.getByRole('gridcell', { name: new RegExp(new Date(today.getFullYear(), today.getMonth(), 20).toDateString()) });
    const data = { getData: () => JSON.stringify({ taskId: TASK_IDS.one, kind: 'qc', from: inMonth(10) }), setData: vi.fn() };
    fireEvent.dragStart(qcChip, { dataTransfer: data });
    fireEvent.dragOver(target, { dataTransfer: data });
    fireEvent.drop(target, { dataTransfer: data });
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { dueDate: isoForDay(inMonth(20)) }));
  });

  it('an editor cannot drag: chips are not draggable', async () => {
    open(<CalendarPage />, 'EDITOR');
    const chips = await screen.findAllByRole('link', { name: /Walmart hook test/ });
    expect(chips.every((c) => c.getAttribute('draggable') !== 'true')).toBe(true);
  });
});

describe('Workload', () => {
  it('counts open work per editor and per QC reviewer, with unassigned last', async () => {
    open(<WorkloadPage />);
    const editors = await screen.findByRole('region', { name: 'Editors' });
    await waitFor(() => expect(within(editors).getAllByRole('link').length).toBe(2));
    const first = within(editors).getAllByRole('link')[0];
    expect(first).toHaveTextContent('2'); // two open tasks for the first editor
    expect(within(editors).getAllByRole('link')[1]).toHaveTextContent('Unassigned');
    const qc = screen.getByRole('region', { name: 'QC reviewers' });
    expect(within(qc).getAllByRole('link')).toHaveLength(1);
  });

  it('links each person to their open tasks', async () => {
    open(<WorkloadPage />);
    const editors = await screen.findByRole('region', { name: 'Editors' });
    const links = await within(editors).findAllByRole('link');
    expect(links[0]).toHaveAttribute('href', `/everything?editor=${PEOPLE.me}&hide=1`);
    expect(links[1]).toHaveAttribute('href', '/everything?editor=none&hide=1');
  });

  it('says plainly when there is no open work', async () => {
    db.searchTasks.mockImplementation(fakeSearch(() => []));
    open(<WorkloadPage />);
    expect(await screen.findByText('No open work')).toBeInTheDocument();
  });
});

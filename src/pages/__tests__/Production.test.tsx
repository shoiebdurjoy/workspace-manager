import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import Production from '@/pages/Production';
import { TooltipProvider } from '@/components/ui/tooltip';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { makeAuth, renderWithAuth } from '@/test/auth-utils';
import type { createDatabaseMock } from '@/test/database-mock';
import * as dbModule from '@/database';
import { MEMBERS, PEOPLE } from '@/test/task-fixtures';
import { IDS } from '@/test/hierarchy-fixtures';
import type { TbbRole } from '@/types/database';

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

const Where: React.FC = () => <span data-testid="where">{useLocation().pathname + useLocation().search}</span>;
const page = (
  <TooltipProvider>
    <Routes>
      <Route path="/production" element={<ProtectedRoute capability="production:view"><Production /></ProtectedRoute>} />
      <Route path="/unauthorized" element={<p>unauthorized</p>} />
      <Route path="/spaces/:s/lists/:l/tasks/:t" element={<p>the task</p>} />
    </Routes>
    <Where />
  </TooltipProvider>
);
const open = (role: TbbRole = 'ADMIN', route = '/production') => renderWithAuth(page, { auth: makeAuth(role), route });

const YEAR = new Date().getFullYear();
const MONTHLY = [
  { editorId: PEOPLE.me, year: YEAR, month: 1, credits: 12 },
  { editorId: PEOPLE.me, year: YEAR - 1, month: 12, credits: 5 },
  { editorId: PEOPLE.editor2, year: YEAR, month: 1, credits: 2 },
];
const VIDEO = {
  taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', title: 'Walmart series - Ep 4', status: 'CLOSED', firstQcSubmittedAt: `${YEAR}-01-15T09:00:00Z`, submittedBy: PEOPLE.me,
  listId: IDS.listEdaptx, listName: '25. EDAPTX', folderName: 'CONTENT PIPELINE - ZIM', spaceId: IDS.spaceA, spaceName: 'Content Pipelines',
  reviewLink: 'https://app.frame.io/r/edited-cut', finalExportLink: 'https://drive.google.com/final', projectFileLink: 'javascript:alert(1)',
};

beforeEach(() => {
  vi.clearAllMocks();
  db.getWorkspaceMembers.mockResolvedValue(MEMBERS);
  db.getProductionMonthly.mockResolvedValue(MONTHLY);
  db.getProductionVideos.mockResolvedValue([VIDEO]);
});

describe('who can open it', () => {
  it.each<TbbRole>(['OWNER', 'ADMIN'])('%s sees the employee list', async (role) => {
    open(role);
    expect(await screen.findByRole('list', { name: 'Employees' })).toBeInTheDocument();
  });

  it.each<TbbRole>(['PRODUCTION_MANAGER', 'QC_SPECIALIST', 'EDITOR', 'CLIENT_VIEWER'])('%s is sent away and nothing is requested', async (role) => {
    open(role);
    expect(await screen.findByText('unauthorized')).toBeInTheDocument();
    expect(db.getProductionMonthly).not.toHaveBeenCalled();
    expect(db.getProductionVideos).not.toHaveBeenCalled();
  });
});

describe('employee list', () => {
  it('shows every editor with this month / this year / all time, in the right words', async () => {
    open();
    const list = await screen.findByRole('list', { name: 'Employees' });
    const pat = within(list).getByRole('button', { name: /Pat Person/ });
    expect(pat).toHaveTextContent('12 this year · 17 all time');
    expect(within(list).getByRole('button', { name: /Eva Editor/ })).toHaveTextContent('2 this year · 2 all time');
    expect(screen.getByText(/Team this month:/)).toHaveTextContent(/Team this month: [0-9]+ videos first submitted for QC/);
    expect(screen.getByText('videos first submitted for QC', { selector: 'strong' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/videos delivered/i);
  });

  it('asks for the production figures once, in the viewer time zone', async () => {
    open();
    await screen.findByRole('list', { name: 'Employees' });
    expect(db.getProductionMonthly).toHaveBeenCalledWith('ws-1', 'UTC');
  });

  it('filters by name', async () => {
    open();
    await screen.findByRole('list', { name: 'Employees' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search employees' }), 'eva');
    expect(screen.queryByRole('button', { name: /Pat Person/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Eva Editor/ })).toBeInTheDocument();
  });

  it('shows a readable error with Try again', async () => {
    db.getProductionMonthly.mockRejectedValueOnce(new Error('Failed to load production: boom'));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('list', { name: 'Employees' })).toBeInTheDocument();
  });
});

describe('an employee, a year, a month', () => {
  it('opening an employee shows their twelve months, and the month number says what it counts', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: /Pat Person/ }));
    const chart = await screen.findByRole('list', { name: `First QC submissions per month, ${YEAR}` });
    expect(within(chart).getByRole('button', { name: `January ${YEAR}: 12 videos first submitted for QC` })).toBeInTheDocument();
    expect(within(chart).getByRole('button', { name: `February ${YEAR}: 0 videos first submitted for QC` })).toBeInTheDocument();
    expect(within(chart).getAllByRole('button')).toHaveLength(12);
    expect(screen.getByTestId('where')).toHaveTextContent(`editor=${PEOPLE.me}`);
  });

  it('months in the future cannot be selected', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: /Pat Person/ }));
    const chart = await screen.findByRole('list', { name: `First QC submissions per month, ${YEAR}` });
    const thisMonth = new Date().getMonth() + 1;
    const buttons = within(chart).getAllByRole('button');
    buttons.forEach((b, i) => (i + 1 > thisMonth ? expect(b).toBeDisabled() : expect(b).toBeEnabled()));
  });

  it('selecting a month lists the real videos: task link, first-QC date, context, edited-video link; unsafe links are never links', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: /Pat Person/ }));
    await userEvent.click(await screen.findByRole('button', { name: `January ${YEAR}: 12 videos first submitted for QC` }));
    const section = await screen.findByRole('region', { name: `Videos first submitted for QC in January ${YEAR}` });
    expect(db.getProductionVideos).toHaveBeenCalledWith('ws-1', PEOPLE.me, YEAR, 1, 'UTC');
    const link = await within(section).findByRole('link', { name: /Walmart series - Ep 4/ });
    expect(link).toHaveAttribute('href', `/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}/tasks/${VIDEO.taskId}`);
    expect(section).toHaveTextContent('Content Pipelines / CONTENT PIPELINE - ZIM / 25. EDAPTX');
    expect(section).toHaveTextContent('First submitted for QC');
    expect(within(section).getByRole('link', { name: /Open Edited video \(app\.frame\.io\)/ })).toHaveAttribute('href', 'https://app.frame.io/r/edited-cut');
    expect(within(section).getByRole('link', { name: /Open Final export/ })).toHaveAttribute('href', 'https://drive.google.com/final');
    expect(within(section).queryByRole('link', { name: /Project file/ })).not.toBeInTheDocument(); // javascript: is not a link
    // the stage shown is the task's stage today, not the stage it had when credited
    expect(section).toHaveTextContent('CLOSED');
    await userEvent.click(link);
    expect(await screen.findByText('the task')).toBeInTheDocument();
  });

  it('browses years; a month with no videos says so; the selection survives in the URL', async () => {
    db.getProductionVideos.mockResolvedValue([]);
    open('OWNER', `/production?editor=${PEOPLE.me}&year=${YEAR - 1}&month=12`);
    expect(await screen.findByRole('list', { name: `First QC submissions per month, ${YEAR - 1}` })).toBeInTheDocument();
    expect(await screen.findByText('Nothing first submitted for QC this month')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next year' }));
    await waitFor(() => expect(screen.getByRole('list', { name: `First QC submissions per month, ${YEAR}` })).toBeInTheDocument());
    expect(screen.getByTestId('where').textContent).not.toMatch(/month=/);
    expect(screen.getByRole('button', { name: 'Next year' })).toBeDisabled();
  });

  it('an unknown employee in the URL is explained, not a blank page', async () => {
    open('ADMIN', '/production?editor=nobody');
    expect(await screen.findByText('Employee not found')).toBeInTheDocument();
  });
});

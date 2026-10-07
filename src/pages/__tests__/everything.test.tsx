import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import EverythingPage from '@/pages/EverythingPage';
import SpacePage from '@/pages/SpacePage';
import FolderPage from '@/pages/FolderPage';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { TooltipProvider } from '@/components/ui/tooltip';
import { makeAuth, renderWithAuth } from '@/test/auth-utils';
import type { createDatabaseMock } from '@/test/database-mock';
import * as dbModule from '@/database';
import { NotFoundError } from '@/database/errors';
import { IDS, makeTree } from '@/test/hierarchy-fixtures';
import { fakeSearch } from '@/test/fake-search';
import { MEMBERS, PEOPLE, TASK_IDS, makeDetail, makeSummary } from '@/test/task-fixtures';
import { TBB_WORKFLOW } from '@/test/workflow-fixture';
import type { TbbRole } from '@/types/database';

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

const Where: React.FC = () => {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
};
const routes = (
  <TooltipProvider>
    <Routes>
      <Route
        path="/everything"
        element={
          <ProtectedRoute capability="hierarchy:view">
            <EverythingPage />
          </ProtectedRoute>
        }
      >
        <Route path="tasks/:taskId" element={null} />
      </Route>
      <Route path="/spaces/:spaceId" element={<SpacePage />} />
      <Route path="/spaces/:spaceId/folders/:folderId" element={<FolderPage />} />
      <Route path="/unauthorized" element={<p>unauthorized</p>} />
    </Routes>
    <Where />
  </TooltipProvider>
);
const open = (role: TbbRole = 'PRODUCTION_MANAGER', route = '/everything') => renderWithAuth(routes, { auth: makeAuth(role), route });

const ROWS = [
  makeSummary({ id: TASK_IDS.one, title: 'Walmart hook test', listId: IDS.listEdaptx, status: 'STARTED_EDITING', editorId: PEOPLE.me, qcId: PEOPLE.qc, position: 0 }),
  makeSummary({ id: TASK_IDS.two, title: 'Conor intro reel', listId: IDS.listConor, status: 'TO_BE_EDITED', position: 1 }),
  makeSummary({ id: TASK_IDS.three, title: 'Raw footage sort', listId: IDS.listIntake, status: 'IN_EDIT', position: 2 }),
];
const lastRequest = () => db.searchTasks.mock.calls.at(-1)?.[1] as { query: string; filters: Record<string, unknown>; sort: string; dir: string };
const titles = () => screen.getAllByRole('link').filter((l) => l.getAttribute('href')?.includes('/tasks/')).map((l) => l.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  db.getWorkspaceHierarchy.mockResolvedValue(makeTree());
  db.getWorkspaceMembers.mockResolvedValue(MEMBERS);
  db.getWorkflow.mockResolvedValue(TBB_WORKFLOW);
  db.searchTasks.mockImplementation(fakeSearch(() => ROWS));
  db.listTasks.mockResolvedValue({ items: [], total: 0 });
  db.getTask.mockImplementation(async (id: string) => {
    const row = ROWS.find((r) => r.id === id);
    if (!row) throw new NotFoundError('Task', id);
    return makeDetail({ id, title: row.title, listId: row.listId });
  });
  db.getLatestRevisionRequest.mockResolvedValue(null);
});

describe('Everything: every task the person can see', () => {
  it('asks the database for all of them (no list restriction), in the manual order', async () => {
    open();
    await screen.findByRole('link', { name: 'Walmart hook test' });
    expect(screen.getByRole('heading', { name: 'Everything' })).toBeInTheDocument();
    expect(db.searchTasks).toHaveBeenCalledWith('ws-1', { query: '', filters: {}, sort: 'manual', dir: 'asc' }, 0);
    expect(titles()).toEqual(expect.arrayContaining(['Walmart hook test', 'Conor intro reel', 'Raw footage sort']));
    expect(screen.getByText('3 tasks')).toBeInTheDocument();
  });

  it('is for staff: a client viewer is sent away and nothing is requested', async () => {
    open('CLIENT_VIEWER');
    expect(await screen.findByText('unauthorized')).toBeInTheDocument();
    expect(db.searchTasks).not.toHaveBeenCalled();
  });

  it.each<TbbRole>(['EDITOR', 'QC_SPECIALIST', 'ADMIN', 'OWNER'])('%s can open it', async (role) => {
    open(role);
    expect(await screen.findByRole('link', { name: 'Conor intro reel' })).toBeInTheDocument();
  });

  it('has no quick add and no New task: a task is created inside a list', async () => {
    open();
    await screen.findByRole('link', { name: 'Walmart hook test' });
    expect(screen.queryByLabelText('Add a task')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New task' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Add a task to/ })).not.toBeInTheDocument();
  });

  it('can narrow by space, folder and list, with the names as they are in the hierarchy', async () => {
    open();
    await screen.findByRole('link', { name: 'Walmart hook test' });
    await userEvent.click(screen.getByRole('button', { name: 'List filter' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Content Pipelines / CONTENT PIPELINE - ZIM / 2. CONOR CONTENT' }));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(lastRequest().filters).toEqual({ lists: [IDS.listConor] }));
    expect(screen.getByTestId('where')).toHaveTextContent(`list=${IDS.listConor}`);
    await waitFor(() => expect(titles()).toEqual(['Conor intro reel']));
    expect(screen.getByRole('button', { name: /^Remove filter: List: Content Pipelines \/ CONTENT PIPELINE - ZIM \/ 2\. CONOR CONTENT/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Space filter' }));
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Content Pipelines', 'Design']);
  });

  it('opens a link like /everything?space=... already narrowed (the "All tasks" button of a space)', async () => {
    open('PRODUCTION_MANAGER', `/everything?space=${IDS.spaceB}`);
    await waitFor(() => expect(lastRequest().filters).toEqual({ spaces: [IDS.spaceB] }));
    expect(screen.getByRole('button', { name: 'Space filter: 1 selected' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove filter: Space: Design' })).toBeInTheDocument();
  });

  it('shows where each task lives in the table, and can group by list', async () => {
    open('PRODUCTION_MANAGER', '/everything?view=table');
    await screen.findByRole('link', { name: 'Walmart hook test' });
    await userEvent.click(screen.getByRole('button', { name: /^Columns:/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'List' }));
    await userEvent.keyboard('{Escape}');
    expect(within(screen.getByRole('table')).getByText('Raw Intake')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Group:/ }));
    await userEvent.click(screen.getByRole('option', { name: 'List' }));
    expect(screen.getAllByRole('rowgroup').map((g) => g.getAttribute('aria-label'))).toEqual(
      expect.arrayContaining([
        'Content Pipelines / CONTENT PIPELINE - ZIM / 25. EDAPTX, 1',
        'Content Pipelines / CONTENT PIPELINE - ZIM / 2. CONOR CONTENT, 1',
        'Content Pipelines / Raw Intake, 1',
      ])
    );
    expect(screen.getByTestId('where')).toHaveTextContent('group=list');
  });

  it('groups by due date', async () => {
    open('PRODUCTION_MANAGER', '/everything?group=due');
    await screen.findByRole('link', { name: 'Walmart hook test' });
    expect(screen.getByRole('group', { name: 'No due date, 3' })).toBeInTheDocument();
  });
});

describe('opening a task over Everything', () => {
  it('shows the task with its own breadcrumbs, keeps the filters in the address, and closes back to them', async () => {
    open('PRODUCTION_MANAGER', '/everything?view=table&priority=MEDIUM');
    await userEvent.click(await screen.findByRole('link', { name: 'Conor intro reel' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/everything/tasks/${TASK_IDS.two}?view=table&priority=MEDIUM`));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByLabelText('Task title')).toHaveValue('Conor intro reel');
    expect(within(dialog).getByRole('link', { name: '2. CONOR CONTENT' })).toHaveAttribute('href', `/spaces/${IDS.spaceA}/lists/${IDS.listConor}`);
    expect(within(dialog).getByRole('link', { name: 'Content Pipelines' })).toBeInTheDocument();
    // the whole list is not downloaded just to know the neighbours: the view's own order is used
    expect(db.listTasks).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/everything?view=table&priority=MEDIUM'));
  });

  it('moves to the previous task in the order the view shows (by stage), staying in Everything', async () => {
    // grouped by stage the order is: TO BE EDITED (two), IN EDIT (three), STARTED EDITING (one)
    open('PRODUCTION_MANAGER', `/everything/tasks/${TASK_IDS.one}`);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText('Task title');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Previous task' })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Previous task' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/everything/tasks/${TASK_IDS.three}`));
  });

  it('a task that is gone sends the person back with a message, not a broken sheet', async () => {
    open('PRODUCTION_MANAGER', `/everything/tasks/${TASK_IDS.three.replace(/3$/, '7')}?view=board`);
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(expect.stringMatching(/not found/)));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/everything?view=board'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a malformed task id is handled the same way', async () => {
    open('PRODUCTION_MANAGER', '/everything/tasks/not-an-id');
    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(db.getTask).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/everything'));
  });
});

describe('the way in from spaces and folders', () => {
  it('a space offers "All tasks", narrowed to it', async () => {
    open('PRODUCTION_MANAGER', `/spaces/${IDS.spaceA}`);
    const link = await screen.findByRole('link', { name: /All tasks/ });
    expect(link).toHaveAttribute('href', `/everything?space=${IDS.spaceA}`);
  });

  it('a folder offers "All tasks", narrowed to it', async () => {
    open('PRODUCTION_MANAGER', `/spaces/${IDS.spaceA}/folders/${IDS.folderZim}`);
    const link = await screen.findByRole('link', { name: /All tasks/ });
    expect(link).toHaveAttribute('href', `/everything?folder=${IDS.folderZim}`);
  });
});

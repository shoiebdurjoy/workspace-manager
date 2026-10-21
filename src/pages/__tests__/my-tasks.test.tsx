import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import MyTasksPage from '@/pages/MyTasksPage';
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
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

const Where: React.FC = () => {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
};
const routes = (
  <TooltipProvider>
    <Routes>
      <Route
        path="/my-tasks"
        element={
          <ProtectedRoute capability="hierarchy:view">
            <MyTasksPage />
          </ProtectedRoute>
        }
      >
        <Route path="tasks/:taskId" element={null} />
      </Route>
      <Route path="/unauthorized" element={<p>unauthorized</p>} />
    </Routes>
    <Where />
  </TooltipProvider>
);
const open = (role: TbbRole = 'EDITOR', route = '/my-tasks') => renderWithAuth(routes, { auth: makeAuth(role), route });

const inDays = (n: number) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12).toISOString();
};
// what the database returns for "assigned to me" (search_tasks with people = [me])
const ROWS = [
  makeSummary({ id: TASK_IDS.one, title: 'Walmart hook test', listId: IDS.listEdaptx, status: 'QC_REVISION_NEEDED', editorId: PEOPLE.me, qcId: PEOPLE.qc, revisionCount: 2, position: 0 }),
  makeSummary({ id: TASK_IDS.two, title: 'Conor intro reel', listId: IDS.listConor, status: 'QC_FIRST_APPROVAL', editorId: PEOPLE.me, qcId: PEOPLE.qc, dueDate: inDays(-1), position: 1 }),
  makeSummary({ id: TASK_IDS.three, title: 'Raw footage sort', listId: IDS.listIntake, status: 'CLOSED', editorId: PEOPLE.me, position: 2 }),
];
const lastRequest = () => db.searchTasks.mock.calls.at(-1)?.[1] as { query: string; filters: Record<string, unknown>; sort: string; dir: string };
const group = (name: RegExp) => screen.getByRole('group', { name });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  db.getWorkspaceHierarchy.mockResolvedValue(makeTree());
  db.getWorkspaceMembers.mockResolvedValue(MEMBERS);
  db.getWorkflow.mockResolvedValue(TBB_WORKFLOW);
  db.searchTasks.mockImplementation(fakeSearch(() => ROWS));
  db.getTask.mockImplementation(async (id: string) => {
    const row = ROWS.find((r) => r.id === id);
    if (!row) throw new NotFoundError('Task', id);
    return makeDetail({ id, title: row.title, listId: row.listId });
  });
  db.getLatestRevisionRequest.mockResolvedValue(null);
  db.getLatestRevisionNotes.mockImplementation(async (ids: readonly string[]) =>
    new Map(
      ids.includes(TASK_IDS.one)
        ? [[TASK_IDS.one, { taskId: TASK_IDS.one, note: 'Fix the audio pop at 00:45\nAlso trim the outro by two seconds and re-export at 9:16.', revisionNumber: 2, actorId: PEOPLE.qc, createdAt: inDays(-1) }]]
        : []
    )
  );
});

describe('My Tasks', () => {
  it('asks the database only for tasks assigned to me (editor or QC reviewer)', async () => {
    open();
    await screen.findByRole('link', { name: 'Walmart hook test' });
    expect(screen.getByRole('heading', { name: 'My Tasks' })).toBeInTheDocument();
    expect(lastRequest().filters).toEqual({ people: [PEOPLE.me] });
  });

  it('starts grouped by "My work": my next step first, then by date, finished last', async () => {
    open();
    await screen.findByRole('link', { name: 'Walmart hook test' });
    expect(within(group(/^Needs my action, 1/)).getByRole('link', { name: 'Walmart hook test' })).toBeInTheDocument();
    expect(within(group(/^Overdue, 1/)).getByRole('link', { name: 'Conor intro reel' })).toBeInTheDocument();
    expect(within(group(/^Finished, 1/)).getByRole('link', { name: 'Raw footage sort' })).toBeInTheDocument();
  });

  it('shows the latest revision request under a cut sent back to me: its first line, then "more"', async () => {
    open();
    await screen.findByText('Fix the audio pop at 00:45');
    expect(db.getLatestRevisionNotes).toHaveBeenCalledWith([TASK_IDS.one]);
    expect(screen.getByText('Revision 2:')).toBeInTheDocument();
    expect(screen.queryByText(/trim the outro/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'more' }));
    expect(screen.getByText(/trim the outro by two seconds/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'less' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps a filter on top of "assigned to me", never instead of it', async () => {
    open('EDITOR', '/my-tasks?priority=URGENT');
    await screen.findByRole('heading', { name: 'My Tasks' });
    await waitFor(() => expect(lastRequest().filters).toEqual({ priorities: ['URGENT'], people: [PEOPLE.me] }));
  });

  it('opens a task over the view at /my-tasks/tasks/:id and keeps the view behind it', async () => {
    open();
    await userEvent.click(await screen.findByRole('link', { name: 'Conor intro reel' }));
    expect(screen.getByTestId('where')).toHaveTextContent(`/my-tasks/tasks/${TASK_IDS.two}`);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // the view stays mounted behind the (modal) sheet
    expect(screen.getByRole('link', { name: 'Walmart hook test', hidden: true })).toBeInTheDocument();
  });

  it('says plainly when nothing is assigned', async () => {
    db.searchTasks.mockImplementation(fakeSearch(() => []));
    open();
    expect(await screen.findByText('Nothing assigned to you')).toBeInTheDocument();
  });

  it('is for staff: a client viewer is sent away and nothing is requested', async () => {
    open('CLIENT_VIEWER');
    expect(await screen.findByText('unauthorized')).toBeInTheDocument();
    expect(db.searchTasks).not.toHaveBeenCalled();
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import ListPage from '../ListPage';
import TaskRedirect from '../TaskRedirect';
import { makeAuth, renderWithAuth } from '@/test/auth-utils';
import type { createDatabaseMock } from '@/test/database-mock';
import * as dbModule from '@/database';
import { NotFoundError } from '@/database/errors';
import { IDS, makeTree } from '@/test/hierarchy-fixtures';
import { MEMBERS, TASK_IDS, makeDetail } from '@/test/task-fixtures';
import { hierarchyPaths } from '@/lib/hierarchy';

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

const Where: React.FC = () => <span data-testid="where">{useLocation().pathname}</span>;
const routes = (
  <>
    <Routes>
      <Route path="/spaces/:spaceId/lists/:listId" element={<ListPage />}>
        <Route path="tasks/:taskId" element={null} />
      </Route>
      <Route path="/tasks/:taskId" element={<TaskRedirect />} />
    </Routes>
    <Where />
  </>
);

beforeEach(() => {
  vi.clearAllMocks();
  db.getWorkspaceHierarchy.mockResolvedValue(makeTree());
  db.getWorkspaceMembers.mockResolvedValue(MEMBERS);
  db.listInvitations.mockResolvedValue([]);
  db.listTeams.mockResolvedValue([]);
  db.listTeamMembers.mockResolvedValue([]);
  db.listTasks.mockResolvedValue({ items: [], total: 0 });
  db.getTask.mockResolvedValue(makeDetail());
});

describe('task URLs', () => {
  it('builds the canonical task URL from the list URL, and a stable id-only link', () => {
    expect(hierarchyPaths.task(IDS.spaceA, IDS.listEdaptx, TASK_IDS.one)).toBe(
      `/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}/tasks/${TASK_IDS.one}`
    );
    expect(hierarchyPaths.taskById(TASK_IDS.one)).toBe(`/tasks/${TASK_IDS.one}`);
  });

  it('the list page stays mounted while a task opens and closes (no second list request)', async () => {
    renderWithAuth(routes, { auth: makeAuth('OWNER'), route: `/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}` });
    await screen.findByText('No tasks in this list yet');
    expect(db.listTasks).toHaveBeenCalledTimes(1);
  });

  it('opening a task URL directly shows the list AND the task sheet', async () => {
    renderWithAuth(routes, {
      auth: makeAuth('OWNER'),
      route: `/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}/tasks/${TASK_IDS.one}`,
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByLabelText('Task title')).toHaveValue('Episode 12 - Founder story');
    // the list is rendered behind the (modal) sheet, so it is hidden from the accessibility tree
    expect(screen.getByRole('heading', { name: '25. EDAPTX', hidden: true })).toBeInTheDocument();
  });

  it('a task URL under an unknown list shows the list not-found screen, never the task', async () => {
    renderWithAuth(routes, {
      auth: makeAuth('OWNER'),
      route: `/spaces/${IDS.spaceA}/lists/${IDS.missing}/tasks/${TASK_IDS.one}`,
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('List not found');
    expect(db.getTask).not.toHaveBeenCalled();
  });
});

describe('/tasks/:taskId deep link', () => {
  it('forwards to the canonical URL of the task, resolved from its list', async () => {
    renderWithAuth(routes, { auth: makeAuth('OWNER'), route: `/tasks/${TASK_IDS.one}` });
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        `/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}/tasks/${TASK_IDS.one}`
      )
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('a task that does not exist (or is not visible) is "not found"', async () => {
    db.getTask.mockRejectedValue(new NotFoundError('Task', TASK_IDS.one));
    renderWithAuth(routes, { auth: makeAuth('OWNER'), route: `/tasks/${TASK_IDS.one}` });
    expect(await screen.findByRole('alert')).toHaveTextContent('Task not found');
    expect(screen.getByTestId('where')).toHaveTextContent(`/tasks/${TASK_IDS.one}`);
  });

  it('a task whose list is not in the visible tree is "not found" (no leak of where it lives)', async () => {
    db.getTask.mockResolvedValue(makeDetail({ listId: IDS.missing }));
    renderWithAuth(routes, { auth: makeAuth('OWNER'), route: `/tasks/${TASK_IDS.one}` });
    expect(await screen.findByRole('alert')).toHaveTextContent('Task not found');
  });

  it('a malformed id never reaches the database', async () => {
    renderWithAuth(routes, { auth: makeAuth('OWNER'), route: '/tasks/not-a-uuid' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Task not found');
    expect(db.getTask).not.toHaveBeenCalled();
  });

  it('a real failure is an error with Try again, not "not found"', async () => {
    db.getTask.mockRejectedValueOnce(new Error('Failed to load the task: connection failure'));
    db.getTask.mockRejectedValueOnce(new Error('Failed to load the task: connection failure'));
    renderWithAuth(routes, { auth: makeAuth('OWNER'), route: `/tasks/${TASK_IDS.one}` });
    expect(await screen.findByText('The task could not be loaded', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText('Task not found')).not.toBeInTheDocument();
  });
});

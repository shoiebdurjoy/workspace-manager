import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { TooltipProvider } from '@/components/ui/tooltip';
import { makeAuth, renderWithAuth } from '@/test/auth-utils';
import type { createDatabaseMock } from '@/test/database-mock';
import * as dbModule from '@/database';
import { IDS, makeTree } from '@/test/hierarchy-fixtures';
import { TASK_IDS, makeSummary } from '@/test/task-fixtures';
import { TBB_WORKFLOW } from '@/test/workflow-fixture';
import type { TbbRole } from '@/types/database';

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

const Where: React.FC = () => {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
};

const palette = (role: TbbRole = 'PRODUCTION_MANAGER') =>
  renderWithAuth(
    <TooltipProvider>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <CommandPalette open onOpenChange={() => undefined} />
              <Where />
            </>
          }
        />
      </Routes>
    </TooltipProvider>,
    { auth: makeAuth(role), route: '/home' }
  );

const FOUND = [
  makeSummary({ id: TASK_IDS.one, title: 'Walmart series - Ep 4 hook', status: 'STARTED_EDITING', listId: IDS.listEdaptx }),
  makeSummary({ id: TASK_IDS.two, title: 'Walmart long cut', status: 'QC_REVISION_NEEDED', listId: IDS.listConor }),
];

beforeEach(() => {
  vi.clearAllMocks();
  db.getWorkspaceHierarchy.mockResolvedValue(makeTree());
  db.getWorkflow.mockResolvedValue(TBB_WORKFLOW);
  db.searchTasks.mockResolvedValue({ items: FOUND, total: 2 });
});

const input = () => screen.getByPlaceholderText(/Find a task, or go to a page/);

describe('find any task from the command palette', () => {
  it('asks the database once two letters are typed and a pause follows, for the best few by recent activity', async () => {
    palette();
    await screen.findByText('Spaces, folders and lists');
    await userEvent.type(input(), 'w');
    await new Promise((r) => setTimeout(r, 300));
    expect(db.searchTasks).not.toHaveBeenCalled(); // one letter is not a search
    await userEvent.type(input(), 'almart');
    expect(await screen.findByText('Walmart series - Ep 4 hook')).toBeInTheDocument();
    expect(db.searchTasks).toHaveBeenCalledTimes(1);
    expect(db.searchTasks).toHaveBeenCalledWith('ws-1', { query: 'walmart', sort: 'updated', dir: 'desc' }, 0, 8);
  });

  it('shows each task with where it lives and its stage, and opens the real task', async () => {
    palette();
    await userEvent.type(input(), 'walmart');
    const hit = await screen.findByRole('option', { name: /Walmart series - Ep 4 hook/ });
    expect(hit).toHaveTextContent('Content Pipelines / CONTENT PIPELINE - ZIM / 25. EDAPTX');
    expect(hit).toHaveTextContent('STARTED EDITING');
    await userEvent.click(hit);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}/tasks/${TASK_IDS.one}`));
  });

  it('shows the task list heading with the real total when there are more matches than shown', async () => {
    db.searchTasks.mockResolvedValue({ items: FOUND, total: 37 });
    palette();
    await userEvent.type(input(), 'walmart');
    expect(await screen.findByText('Tasks (2 of 37)')).toBeInTheDocument();
    // with results on screen the palette must not also claim there are none
    expect(screen.queryByText('No results found.')).not.toBeInTheDocument();
  });

  it('keeps finding pages and lists too, alongside tasks', async () => {
    palette();
    await userEvent.type(input(), 'conor');
    expect(await screen.findByRole('option', { name: /2\. CONOR CONTENT/ })).toBeInTheDocument();
  });

  it('says so when nothing matches, and never invents a result', async () => {
    db.searchTasks.mockResolvedValue({ items: [], total: 0 });
    palette();
    await userEvent.type(input(), 'qqqqzz');
    expect(await screen.findByText('No results found.')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Walmart/ })).not.toBeInTheDocument();
  });

  it('lists Everything (all tasks) as a place to go', async () => {
    palette();
    await userEvent.click(await screen.findByRole('option', { name: /Everything/ }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/everything'));
  });

  it('is for staff only: a client viewer never triggers a task search', async () => {
    palette('CLIENT_VIEWER');
    await userEvent.type(input(), 'walmart');
    await new Promise((r) => setTimeout(r, 350));
    expect(db.searchTasks).not.toHaveBeenCalled();
    expect(within(document.body).queryByText('Tasks')).not.toBeInTheDocument();
  });
});

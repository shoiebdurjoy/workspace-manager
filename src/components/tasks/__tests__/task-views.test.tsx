import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import ListPage from '@/pages/ListPage';
import { makeAuth, renderWithAuth } from '@/test/auth-utils';
import type { createDatabaseMock } from '@/test/database-mock';
import * as dbModule from '@/database';
import { IDS, makeTree } from '@/test/hierarchy-fixtures';
import { MEMBERS, PEOPLE, TASK_IDS, makeDetail, makeSummary } from '@/test/task-fixtures';
import { TBB_WORKFLOW } from '@/test/workflow-fixture';
import { tableColumnsStorageKey } from '@/hooks/use-table-columns';
import { viewModeStorageKey } from '@/hooks/use-view-mode';
import type { TbbRole } from '@/types/database';

// The real drag needs layout (rectangles) that jsdom does not have, so the context is replaced by a
// stand-in that hands its handlers to the test: it exercises OUR drop logic with real workflow rules.
const dnd = vi.hoisted(() => ({ props: null as null | Record<string, (e: unknown) => void> }));
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...mod,
    DndContext: (props: Record<string, unknown> & { children: React.ReactNode }) => {
      dnd.props = props as never;
      return <>{props.children}</>;
    },
  };
});

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

const Where: React.FC = () => {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
};
const routes = (
  <>
    <Routes>
      <Route path="/spaces/:spaceId/lists/:listId" element={<ListPage />}>
        <Route path="tasks/:taskId" element={null} />
      </Route>
    </Routes>
    <Where />
  </>
);
const LIST_URL = `/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}`;
const renderList = (role: TbbRole = 'PRODUCTION_MANAGER', route = LIST_URL) => renderWithAuth(routes, { auth: makeAuth(role), route });

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const ROWS = [
  makeSummary({ id: TASK_IDS.one, title: 'Founder story', status: 'STARTED_EDITING', priority: 'URGENT', editorId: PEOPLE.me, qcId: PEOPLE.qc, dueDate: '2099-01-02T12:00:00.000Z', subtaskTotal: 4, subtaskDone: 1, reviewLink: 'https://app.frame.io/r/1', position: 0, aspectRatio: '9:16' }),
  makeSummary({ id: TASK_IDS.two, title: 'Product teaser', status: 'QC_FIRST_APPROVAL', editorId: PEOPLE.editor2, qcId: PEOPLE.qc, reviewLink: 'https://app.frame.io/r/2', position: 1 }),
  makeSummary({ id: TASK_IDS.three, title: 'Behind the scenes', status: 'TO_BE_EDITED', position: 2 }),
  makeSummary({ id: id(4), title: 'Recut ad', status: 'QC_REVISION_NEEDED', revisionCount: 2, editorId: PEOPLE.me, reviewLink: 'https://app.frame.io/r/4', position: 3 }),
];

const openView = async (view: 'list' | 'board' | 'table', role: TbbRole = 'PRODUCTION_MANAGER') => {
  renderList(role, `${LIST_URL}?view=${view}`);
  await screen.findByRole('link', { name: 'Founder story' });
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  dnd.props = null;
  db.getWorkspaceHierarchy.mockResolvedValue(makeTree());
  db.getWorkspaceMembers.mockResolvedValue(MEMBERS);
  db.listInvitations.mockResolvedValue([]);
  db.listTeams.mockResolvedValue([]);
  db.listTeamMembers.mockResolvedValue([]);
  db.listTasks.mockResolvedValue({ items: ROWS, total: ROWS.length });
  db.getTask.mockResolvedValue(makeDetail());
  db.updateTask.mockImplementation(async (taskId: string) => ({ ...makeDetail({ id: taskId }), updatedAt: 'now' }));
  db.setTaskAssignee.mockResolvedValue(undefined);
  db.createTask.mockResolvedValue({ id: 'new-task', title: 'New one', status: 'TO_BE_EDITED' });
  db.getWorkflow.mockResolvedValue(TBB_WORKFLOW);
  db.transitionTask.mockImplementation(async (taskId: string, input: { to: string }) => ({ ...makeDetail({ id: taskId }), status: input.to, updatedAt: 'now' }));
  db.getLatestRevisionRequest.mockResolvedValue(null);
  window.innerWidth = 1280;
});

/** What the real drag would do: pick a card up and let go over a stage column. */
const drag = (taskId: string, toStatus: string | undefined) => {
  act(() => dnd.props?.onDragStart?.({ active: { id: taskId } }));
  act(() => dnd.props?.onDragEnd?.({ active: { id: taskId }, over: toStatus ? { data: { current: { status: toStatus } } } : null }));
};

describe('view switching', () => {
  it('opens the List by default and switches with the tabs; the choice goes into the URL, keeping everything else', async () => {
    renderList('PRODUCTION_MANAGER', `${LIST_URL}?q=keep`);
    await screen.findByRole('link', { name: 'Founder story' });
    const tabs = screen.getByRole('tablist', { name: 'View' });
    expect(within(tabs).getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Board' }));
    expect(screen.getByTestId('where')).toHaveTextContent('view=board');
    expect(screen.getByTestId('where')).toHaveTextContent('q=keep');
    expect(await screen.findByRole('region', { name: 'Board' })).toBeInTheDocument();
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Table' }));
    expect(screen.getByTestId('where')).toHaveTextContent('view=table');
    expect(await screen.findByRole('table', { name: 'Tasks table' })).toBeInTheDocument();
    await userEvent.click(within(tabs).getByRole('tab', { name: 'List' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Board' })).not.toBeInTheDocument();
  });

  it('arrow keys move between the tabs', async () => {
    await openView('list');
    const list = screen.getByRole('tab', { name: 'List' });
    list.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Table' })).toHaveAttribute('aria-selected', 'true');
  });

  it('a link with ?view=board opens the board; an unknown value falls back; the last used view is remembered per list', async () => {
    const first = renderList('PRODUCTION_MANAGER', `${LIST_URL}?view=nonsense`);
    await screen.findByRole('link', { name: 'Founder story' });
    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'Table' }));
    expect(window.localStorage.getItem(viewModeStorageKey(IDS.listEdaptx))).toBe('table');
    first.unmount();
    renderList(); // no ?view: the last one used
    expect(await screen.findByRole('table', { name: 'Tasks table' })).toBeInTheDocument();
  });

  it('shows the same real tasks in all three views (one query, no copies)', async () => {
    await openView('list');
    expect(db.listTasks).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('tab', { name: 'Board' }));
    expect(screen.getByRole('link', { name: 'Founder story' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Table' }));
    expect(screen.getByRole('link', { name: 'Founder story' })).toBeInTheDocument();
    expect(db.listTasks).toHaveBeenCalledTimes(1);
  });

  it('keeps the search and filters when the view changes, and the URL when a task opens and closes', async () => {
    await openView('board');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'story');
    expect(screen.queryByRole('link', { name: 'Product teaser' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Table' }));
    expect(screen.getByRole('link', { name: 'Founder story' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Product teaser' })).not.toBeInTheDocument();
    // opening a task keeps ?view=table in the address, closing it returns there
    await userEvent.click(screen.getByRole('link', { name: 'Founder story' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/tasks/${TASK_IDS.one}?view=table`));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`${LIST_URL}?view=table`));
  });
});

describe('board', () => {
  it('has one column per workflow stage, in order, with counts, even for empty stages', async () => {
    await openView('board');
    const groups = within(screen.getByRole('region', { name: 'Board' })).getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual([
      'TO BE EDITED, 1', 'IN EDIT, 0', 'ASSIGNED, 0', 'STARTED EDITING, 1', 'QC - FIRST APPROVAL, 1',
      'QC - REVISION NEEDED, 1', 'QC - FINAL APPROVAL, 0', 'QC - APPROVED (RTD), 0', 'SENT TO CLIENT, 0', 'CLOSED, 0',
    ]);
  });

  it('cards show who, when, how urgent, progress and revisions, and open the real task', async () => {
    await openView('board');
    const col = screen.getByRole('group', { name: 'STARTED EDITING, 1' });
    const card = within(col).getByRole('link', { name: 'Founder story' }).closest('li') as HTMLElement;
    expect(within(card).getByRole('link', { name: 'Founder story' })).toHaveAttribute('href', `${LIST_URL}/tasks/${TASK_IDS.one}?view=board`);
    expect(within(card).getByLabelText('1 of 4 subtasks done')).toBeInTheDocument();
    expect(within(card).getByText('9:16')).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: 'Editor: Pat Person' })).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: 'QC: Quinn QC' })).toBeInTheDocument();
    const rev = within(screen.getByRole('group', { name: 'QC - REVISION NEEDED, 1' })).getByText('Revision 2');
    expect(rev).toBeInTheDocument();
  });

  it('a card offers its next step and a Move menu without dragging (the keyboard and touch path)', async () => {
    await openView('board');
    const card = within(screen.getByRole('group', { name: 'STARTED EDITING, 1' })).getByRole('link', { name: 'Founder story' }).closest('li') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: 'Submit for QC: Founder story' }));
    await waitFor(() => expect(db.transitionTask).toHaveBeenCalledWith(TASK_IDS.one, expect.objectContaining({ to: 'QC_FIRST_APPROVAL', expectedFrom: 'STARTED_EDITING' })));
    // optimistic: the card is already in its new column
    expect(await screen.findByRole('group', { name: 'QC - FIRST APPROVAL, 2' })).toBeInTheDocument();

    // the move menu is on every card: it lists this card's steps from where it is now
    const moved = within(screen.getByRole('group', { name: 'QC - FIRST APPROVAL, 2' })).getByRole('link', { name: 'Founder story' }).closest('li') as HTMLElement;
    await userEvent.click(within(moved).getByRole('combobox', { name: 'Move Founder story' }));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(card).toBeDefined();
  });

  describe('drag and drop uses the workflow rules', () => {
    it('a valid drop moves the card through transition_task, optimistically', async () => {
      await openView('board');
      drag(TASK_IDS.three, 'IN_EDIT'); // TO BE EDITED -> IN EDIT: a manager step
      await waitFor(() => expect(db.transitionTask).toHaveBeenCalledWith(TASK_IDS.three, expect.objectContaining({ to: 'IN_EDIT', expectedFrom: 'TO_BE_EDITED' })));
      expect(db.updateTask).not.toHaveBeenCalled();
      expect(await screen.findByRole('group', { name: 'IN EDIT, 1' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'TO BE EDITED, 0' })).toBeInTheDocument();
    });

    it('an invalid drop is refused with the reason, and nothing moves or is sent', async () => {
      await openView('board');
      drag(TASK_IDS.three, 'CLOSED');
      expect(toasts.error).toHaveBeenCalledWith('Not a step from TO BE EDITED.');
      expect(db.transitionTask).not.toHaveBeenCalled();
      expect(screen.getByRole('group', { name: 'TO BE EDITED, 1' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'CLOSED, 0' })).toBeInTheDocument();
    });

    it('dropping on its own column, or outside any column, does nothing', async () => {
      await openView('board');
      drag(TASK_IDS.three, 'TO_BE_EDITED');
      drag(TASK_IDS.three, undefined);
      expect(db.transitionTask).not.toHaveBeenCalled();
      expect(toasts.error).not.toHaveBeenCalled();
    });

    it('a move that needs something opens the same dialog, and only moves once it is given', async () => {
      await openView('board');
      drag(TASK_IDS.two, 'QC_REVISION_NEEDED'); // a revision needs a note
      const dialog = await screen.findByRole('dialog', { name: 'Request revision' });
      expect(db.transitionTask).not.toHaveBeenCalled();
      expect(screen.getByRole('group', { name: 'QC - FIRST APPROVAL, 1', hidden: true })).toBeInTheDocument(); // card has not moved
      await userEvent.type(within(dialog).getByLabelText('What needs to change?'), 'Fix the intro');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Request revision' }));
      await waitFor(() => expect(db.transitionTask).toHaveBeenCalledWith(TASK_IDS.two, expect.objectContaining({ to: 'QC_REVISION_NEEDED', note: 'Fix the intro' })));
      expect(await screen.findByRole('group', { name: 'QC - REVISION NEEDED, 2' })).toBeInTheDocument();
    });

    it('cancelling the dialog leaves the card where it was', async () => {
      await openView('board');
      drag(TASK_IDS.two, 'QC_REVISION_NEEDED');
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'QC - FIRST APPROVAL, 1' })).toBeInTheDocument();
      expect(db.transitionTask).not.toHaveBeenCalled();
    });

    it('when the database refuses a drop, the card is put back and the reason is shown', async () => {
      db.transitionTask.mockRejectedValue(new Error('Your role cannot move a task from TO BE EDITED to IN EDIT.'));
      await openView('board');
      drag(TASK_IDS.three, 'IN_EDIT');
      await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Your role cannot move a task from TO BE EDITED to IN EDIT.'));
      expect(await screen.findByRole('group', { name: 'TO BE EDITED, 1' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'IN EDIT, 0' })).toBeInTheDocument();
    });

    it('someone else moved it first: refused, undone, and the list reloads to show the truth', async () => {
      db.transitionTask.mockRejectedValue(new db.StaleTransitionError());
      await openView('board');
      drag(TASK_IDS.three, 'IN_EDIT');
      await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(expect.stringMatching(/Someone else moved this task/)));
      await waitFor(() => expect(db.listTasks.mock.calls.length).toBeGreaterThan(1));
    });

    it('an editor can only drag their own cuts along editing steps; approval is refused with the reason', async () => {
      await openView('board', 'EDITOR');
      drag(TASK_IDS.one, 'QC_APPROVED_RTD');
      expect(toasts.error).toHaveBeenCalledWith('Not a step from STARTED EDITING.');
      drag(TASK_IDS.three, 'IN_EDIT'); // not theirs
      expect(toasts.error).toHaveBeenCalledWith('Only the editor assigned to this task can move it.');
      expect(db.transitionTask).not.toHaveBeenCalled();
      drag(TASK_IDS.one, 'QC_FIRST_APPROVAL');
      await waitFor(() => expect(db.transitionTask).toHaveBeenCalledWith(TASK_IDS.one, expect.objectContaining({ to: 'QC_FIRST_APPROVAL' })));
    });

    it('QC can request a revision from first approval but cannot start editing', async () => {
      await openView('board', 'QC_SPECIALIST');
      drag(TASK_IDS.two, 'STARTED_EDITING');
      expect(toasts.error).toHaveBeenCalledWith(expect.stringMatching(/Only .* can do this/));
      expect(db.transitionTask).not.toHaveBeenCalled();
    });

    it('cards nobody here may move have no move menu, and there is nothing to drag', async () => {
      await openView('board', 'QC_SPECIALIST');
      const card = within(screen.getByRole('group', { name: 'TO BE EDITED, 1' })).getByRole('link', { name: 'Behind the scenes' }).closest('li') as HTMLElement;
      expect(within(card).queryByRole('combobox')).not.toBeInTheDocument();
      expect(card.className).not.toMatch(/cursor-grab/);
    });
  });

  it('on a phone there is no dragging: cards keep their buttons', async () => {
    window.innerWidth = 480;
    await openView('board');
    const card = within(screen.getByRole('group', { name: 'STARTED EDITING, 1' })).getByRole('link', { name: 'Founder story' }).closest('li') as HTMLElement;
    expect(card.className).not.toMatch(/cursor-grab/);
    expect(within(card).getByRole('button', { name: 'Submit for QC: Founder story' })).toBeInTheDocument();
  });

  it('a column collapses to a narrow strip and comes back', async () => {
    await openView('board');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse CLOSED' }));
    expect(screen.getByRole('button', { name: 'Expand CLOSED' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Expand CLOSED' }));
    expect(screen.getByRole('button', { name: 'Collapse CLOSED' })).toBeInTheDocument();
  });

  it('adds a task straight into a column the new task can reach in one step', async () => {
    await openView('board');
    expect(screen.queryByRole('button', { name: 'Add a task to STARTED EDITING' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add a task to IN EDIT' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Add a task to IN EDIT' }), 'Teaser v2{Enter}');
    await waitFor(() => expect(db.createTask).toHaveBeenCalledWith(IDS.listEdaptx, { title: 'Teaser v2' }));
    await waitFor(() => expect(db.transitionTask).toHaveBeenCalledWith('new-task', expect.objectContaining({ to: 'IN_EDIT' })));
  });

  it('long columns show the first cards and offer "Show more"', async () => {
    const many = Array.from({ length: 45 }, (_, i) => makeSummary({ id: id(100 + i), title: `Clip ${i}`, status: 'TO_BE_EDITED', position: i }));
    db.listTasks.mockResolvedValue({ items: many, total: 45 });
    renderList('PRODUCTION_MANAGER', `${LIST_URL}?view=board`);
    await screen.findByRole('link', { name: 'Clip 0' });
    expect(screen.queryByRole('link', { name: 'Clip 40' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Show 15 more/ }));
    expect(screen.getByRole('link', { name: 'Clip 40' })).toBeInTheDocument();
  });

  it('shows an empty-result message when filters match nothing, with a way out', async () => {
    await openView('board');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'zzzz');
    expect(await screen.findByText('No tasks match these filters.')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /Clear filters/ })[0]);
    expect(await screen.findByRole('link', { name: 'Founder story' })).toBeInTheDocument();
  });
});

describe('table', () => {
  const rowOf = (title: string) => screen.getByRole('link', { name: title }).closest('tr') as HTMLElement;

  it('has a header per column, one row per task, and the stage as the real workflow name', async () => {
    await openView('table');
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers).toEqual(expect.arrayContaining(['Task', 'Status', 'Editor', 'QC reviewer', 'QC due', 'Client deadline', 'Priority', 'Links']));
    expect(within(rowOf('Founder story')).getByRole('combobox', { name: 'Status' })).toHaveTextContent('STARTED EDITING');
    expect(within(rowOf('Founder story')).getByRole('combobox', { name: 'Editor' })).toHaveTextContent('Pat Person');
  });

  it('sorts by clicking a header: ascending, descending, then back to manual order', async () => {
    await openView('table');
    await userEvent.click(screen.getByRole('button', { name: /^Group:/ }));
    await userEvent.click(screen.getByRole('option', { name: 'No grouping' }));
    const order = () => within(screen.getByRole('table')).getAllByRole('link').filter((l) => l.getAttribute('href')?.includes('/tasks/')).map((l) => l.textContent);
    expect(order()).toEqual(['Founder story', 'Product teaser', 'Behind the scenes', 'Recut ad']); // manual order
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Task' }));
    expect(order()).toEqual(['Behind the scenes', 'Founder story', 'Product teaser', 'Recut ad']);
    expect(screen.getByRole('columnheader', { name: /Task/ })).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(screen.getByRole('button', { name: /Sort by Task, ascending/ }));
    expect(order()).toEqual(['Recut ad', 'Product teaser', 'Founder story', 'Behind the scenes']);
    expect(screen.getByRole('columnheader', { name: /Task/ })).toHaveAttribute('aria-sort', 'descending');
    await userEvent.click(screen.getByRole('button', { name: /Sort by Task, descending/ }));
    expect(order()).toEqual(['Founder story', 'Product teaser', 'Behind the scenes', 'Recut ad']);
    expect(screen.getByRole('columnheader', { name: /Task/ })).toHaveAttribute('aria-sort', 'none');
  });

  it('sorts by stage in workflow order', async () => {
    await openView('table');
    await userEvent.click(screen.getByRole('button', { name: /^Group:/ }));
    await userEvent.click(screen.getByRole('option', { name: 'No grouping' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Status' }));
    const stages = within(screen.getByRole('table')).getAllByRole('combobox', { name: 'Status' }).map((c) => c.textContent);
    expect(stages).toEqual(['TO BE EDITED', 'STARTED EDITING', 'QC - FIRST APPROVAL', 'QC - REVISION NEEDED']);
  });

  it('edits cells inline: stage, priority, editor and dates all go through the normal paths', async () => {
    await openView('table');
    await userEvent.click(within(rowOf('Behind the scenes')).getByRole('combobox', { name: 'Status' }));
    await userEvent.click(await screen.findByRole('option', { name: /Move to edit queue/ }));
    await waitFor(() => expect(db.transitionTask).toHaveBeenCalledWith(TASK_IDS.three, expect.objectContaining({ to: 'IN_EDIT' })));

    await userEvent.click(within(rowOf('Behind the scenes')).getByRole('combobox', { name: 'Priority' }));
    await userEvent.click(await screen.findByRole('option', { name: /Urgent/ }));
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.three, { priority: 'URGENT' }));

    await userEvent.click(within(rowOf('Behind the scenes')).getByRole('combobox', { name: 'Editor' }));
    await userEvent.click(await screen.findByRole('option', { name: /Eva Editor/ }));
    await waitFor(() => expect(db.setTaskAssignee).toHaveBeenCalledWith(TASK_IDS.three, 'EDITOR', PEOPLE.editor2));

    await userEvent.click(within(rowOf('Behind the scenes')).getByRole('button', { name: 'Client deadline: not set' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Tomorrow' }));
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.three, { clientDeadline: expect.stringMatching(/T\d\d:00:00\.000Z$/) }));
  });

  it('edits a production link in a popover, validated, and renames in place', async () => {
    await openView('table');
    await userEvent.click(within(rowOf('Behind the scenes')).getByRole('button', { name: 'Edit links of Behind the scenes' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add Review link' }));
    await userEvent.type(screen.getByLabelText('Review link'), 'https://app.frame.io/r/new');
    await userEvent.tab();
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.three, { reviewLink: 'https://app.frame.io/r/new' }));
    await userEvent.keyboard('{Escape}');

    await userEvent.click(within(rowOf('Behind the scenes')).getByRole('button', { name: 'Rename Behind the scenes' }));
    await userEvent.type(screen.getByLabelText('Rename Behind the scenes'), ' (BTS){Enter}');
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.three, { title: 'Behind the scenes (BTS)' }));
  });

  it('selects rows (shift for a range, header for all) and offers the bulk bar', async () => {
    await openView('table');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Behind the scenes' }));
    const user = userEvent.setup();
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('checkbox', { name: 'Select Recut ad' }));
    await user.keyboard('{/Shift}');
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('4 selected');
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all tasks' }));
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('4 selected');
  });

  it('shows and hides columns, remembers the choice, and can reset it', async () => {
    const first = renderList('PRODUCTION_MANAGER', `${LIST_URL}?view=table`);
    await screen.findByRole('link', { name: 'Founder story' });
    expect(screen.queryByRole('columnheader', { name: 'Aspect ratio' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Columns:/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Aspect ratio' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'QC reviewer' }));
    expect(screen.getByRole('columnheader', { name: 'Aspect ratio' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /QC reviewer/ })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(tableColumnsStorageKey) ?? '[]')).toContain('aspectRatio');
    await userEvent.keyboard('{Escape}');
    first.unmount();
    renderList('PRODUCTION_MANAGER', `${LIST_URL}?view=table`);
    await screen.findByRole('link', { name: 'Founder story' });
    expect(screen.getByRole('columnheader', { name: 'Aspect ratio' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Columns:/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(screen.queryByRole('columnheader', { name: 'Aspect ratio' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /QC reviewer/ })).toBeInTheDocument();
  });

  it('a corrupt stored column list falls back to the defaults', async () => {
    window.localStorage.setItem(tableColumnsStorageKey, '{"nope":true}');
    await openView('table');
    expect(screen.getByRole('columnheader', { name: /QC reviewer/ })).toBeInTheDocument();
  });

  it('groups with collapsible group rows', async () => {
    await openView('table');
    await userEvent.click(screen.getByRole('button', { name: /^Group:/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Priority' }));
    expect(screen.getAllByRole('rowgroup').length).toBeGreaterThan(1);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Urgent' }));
    expect(screen.queryByRole('link', { name: 'Founder story' })).not.toBeInTheDocument();
  });

  it('draws long tables progressively', async () => {
    const many = Array.from({ length: 180 }, (_, i) => makeSummary({ id: id(1000 + i), title: `Clip ${i}`, position: i }));
    db.listTasks.mockResolvedValue({ items: many, total: 180 });
    renderList('PRODUCTION_MANAGER', `${LIST_URL}?view=table`);
    await screen.findByRole('link', { name: 'Clip 0' });
    expect(screen.queryByRole('link', { name: 'Clip 170' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Show 30 more/ }));
    expect(screen.getByRole('link', { name: 'Clip 170' })).toBeInTheDocument();
  });

  describe('permissions', () => {
    it('an editor edits only their own rows, and nothing else', async () => {
      await openView('table', 'EDITOR');
      expect(within(rowOf('Founder story')).getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
      expect(within(rowOf('Behind the scenes')).queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Priority' })).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Editor' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Rename / })).not.toBeInTheDocument();
      // only the links they may change
      expect(within(rowOf('Founder story')).getByRole('button', { name: 'Edit links of Founder story' })).toBeInTheDocument();
      expect(within(rowOf('Behind the scenes')).queryByRole('button', { name: /Edit links/ })).not.toBeInTheDocument();
    });

    it('QC sees plain values for the brief and can edit only the final export', async () => {
      await openView('table', 'QC_SPECIALIST');
      expect(screen.queryByRole('combobox', { name: 'Priority' })).not.toBeInTheDocument();
      await userEvent.click(within(rowOf('Product teaser')).getByRole('button', { name: 'Edit links of Product teaser' }));
      expect(await screen.findByRole('button', { name: 'Add Final export' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add Project file' })).not.toBeInTheDocument();
    });
  });
});

describe('no fake data in any view', () => {
  it('every view renders only what the database returned', async () => {
    db.listTasks.mockResolvedValue({ items: [ROWS[2]], total: 1 });
    for (const view of ['list', 'board', 'table'] as const) {
      const { unmount } = renderList('PRODUCTION_MANAGER', `${LIST_URL}?view=${view}`);
      await screen.findByRole('link', { name: 'Behind the scenes' });
      expect(screen.getAllByRole('link').filter((l) => l.getAttribute('href')?.includes('/tasks/'))).toHaveLength(1);
      unmount();
    }
  });
});

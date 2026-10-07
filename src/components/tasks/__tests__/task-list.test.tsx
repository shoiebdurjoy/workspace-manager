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
import { taskViewStorageKey } from '@/hooks/use-task-view';
import type { TbbRole } from '@/types/database';

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

const Where: React.FC = () => <span data-testid="where">{useLocation().pathname}</span>;
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

const ROWS = [
  makeSummary({
    id: TASK_IDS.one, title: 'Episode 12 - Founder story', status: 'IN_PROGRESS', priority: 'URGENT', aspectRatio: '9:16',
    dueDate: '2020-01-02T12:00:00.000Z', clientDeadline: '2099-01-02T12:00:00.000Z', editorId: PEOPLE.me, qcId: PEOPLE.qc,
    subtaskTotal: 4, subtaskDone: 1, position: 0, rawFootageLink: 'https://drive.google.com/x', reviewLink: 'https://app.frame.io/r/1',
  }),
  makeSummary({ id: TASK_IDS.two, title: 'Product teaser', status: 'COMPLETED', priority: 'LOW', position: 1, editorId: PEOPLE.editor2 }),
  makeSummary({ id: TASK_IDS.three, title: 'Behind the scenes', status: 'TODO', position: 2 }),
];

/** The row (list item) of a task, found from its title link. */
const row = (title: string) => screen.getByRole('link', { name: title }).closest('li') as HTMLElement;
/** A row renders its controls twice (table columns + phone layout; CSS decides which shows). */
const first = <T extends HTMLElement>(els: T[]) => els[0];

beforeEach(() => {
  vi.clearAllMocks();
  db.getWorkspaceHierarchy.mockResolvedValue(makeTree());
  db.getWorkspaceMembers.mockResolvedValue(MEMBERS);
  db.listInvitations.mockResolvedValue([]);
  db.listTeams.mockResolvedValue([]);
  db.listTeamMembers.mockResolvedValue([]);
  db.listTasks.mockResolvedValue({ items: ROWS, total: 3 });
  db.getTask.mockResolvedValue(makeDetail());
  db.updateTask.mockImplementation(async (id: string) => ({ ...makeDetail({ id }), updatedAt: 'now' }));
  db.setTaskAssignee.mockResolvedValue(undefined);
  db.createTask.mockResolvedValue({ id: 'new-task', title: 'New one' });
  db.deleteTask.mockResolvedValue(undefined);
  db.moveTask.mockResolvedValue(true);
  db.updateSubtask.mockResolvedValue({});
});

describe('the list workspace: real data, grouped', () => {
  it('groups tasks by status (in workflow order) with counts, and shows each row with its properties', async () => {
    renderList();
    await screen.findByRole('link', { name: 'Product teaser' });
    expect(db.listTasks).toHaveBeenCalledWith(IDS.listEdaptx, 0);
    const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['To do, 1', 'In progress, 1', 'Completed, 1']); // empty statuses are not shown

    const r = row('Episode 12 - Founder story');
    expect(screen.getByRole('link', { name: 'Episode 12 - Founder story' })).toHaveAttribute('href', `${LIST_URL}/tasks/${TASK_IDS.one}`);
    expect(first(within(r).getAllByRole('combobox', { name: 'Status' }))).toHaveTextContent('In progress');
    expect(first(within(r).getAllByRole('combobox', { name: 'Editor: Pat Person' }))).toBeInTheDocument();
    expect(first(within(r).getAllByRole('combobox', { name: 'QC reviewer: Quinn QC' }))).toBeInTheDocument();
    expect(within(r).getAllByLabelText('1 of 4 subtasks done').length).toBeGreaterThan(0);
    // overdue QC date is flagged; production links open in a new tab, safely
    expect(first(within(r).getAllByRole('button', { name: /^Internal QC due: / })).innerHTML).toMatch(/text-destructive/);
    const footage = first(within(r).getAllByRole('link', { name: /Open Raw footage \(drive\.google\.com\)/ }));
    expect(footage).toHaveAttribute('href', 'https://drive.google.com/x');
    expect(footage).toHaveAttribute('rel', 'noopener noreferrer');
    // a finished task reads as done and is never "overdue"
    expect(screen.getByRole('link', { name: 'Product teaser' }).className).toMatch(/line-through/);
    expect(screen.getByText('3 tasks')).toBeInTheDocument();
  });

  it('loads the whole list, page after page, so groups and counts are exact', async () => {
    const page1 = Array.from({ length: 500 }, (_, i) =>
      makeSummary({ id: `cccccccc-cccc-4ccc-8ccc-${String(i).padStart(12, '0')}`, title: `Clip ${i}`, position: i })
    );
    db.listTasks.mockImplementation(async (_list: string, page: number) =>
      page === 0 ? { items: page1, total: 501 } : { items: [makeSummary({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd01', title: 'Clip 500', position: 500 })], total: 501 }
    );
    renderList();
    expect(await screen.findByRole('link', { name: 'Clip 500' }, { timeout: 5000 })).toBeInTheDocument();
    expect(db.listTasks).toHaveBeenCalledWith(IDS.listEdaptx, 1);
    expect(screen.getByRole('group', { name: 'To do, 501' })).toBeInTheDocument();
  }, 30_000);

  it('highlights the task whose sheet is open', async () => {
    renderList('OWNER', `${LIST_URL}/tasks/${TASK_IDS.two}`);
    // the open sheet is modal, so the list behind it is hidden from the accessibility tree
    const link = await screen.findByRole('link', { name: 'Product teaser', hidden: true });
    expect(link).toHaveAttribute('aria-current', 'true');
  });

  it('shows a loading state, then the tasks', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    db.listTasks.mockReturnValue(new Promise((r) => (resolve = r)));
    renderList();
    expect(await screen.findByRole('status', { name: 'Loading tasks' })).toBeInTheDocument();
    resolve({ items: ROWS, total: 3 });
    expect(await screen.findByRole('link', { name: 'Product teaser' })).toBeInTheDocument();
  });

  it('shows a readable error with Try again that really retries', async () => {
    db.listTasks.mockRejectedValueOnce(new Error('Failed to load the tasks: connection failure'));
    renderList();
    expect(await screen.findByRole('alert')).toHaveTextContent('connection failure');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('link', { name: 'Product teaser' })).toBeInTheDocument();
  });

  it('an empty list has a designed empty state (no invented tasks); managers can start from it', async () => {
    db.listTasks.mockResolvedValue({ items: [], total: 0 });
    renderList('PRODUCTION_MANAGER');
    expect(await screen.findByText('No tasks in this list yet')).toBeInTheDocument();
    expect(screen.getByLabelText('Add a task')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it.each<TbbRole>(['EDITOR', 'QC_SPECIALIST'])('an empty list for a %s offers no way to create', async (role) => {
    db.listTasks.mockResolvedValue({ items: [], total: 0 });
    renderList(role);
    expect(await screen.findByText(/added to this list by a Production Manager/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Add a task')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New task' })).not.toBeInTheDocument();
  });

  it('does not loop re-rendering while people are still loading (regression)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    db.getWorkspaceMembers.mockReturnValue(new Promise(() => undefined));
    renderList();
    await screen.findByRole('link', { name: 'Product teaser' });
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/Maximum update depth/);
    errors.mockRestore();
  });
});

describe('editing right in the list (inline, optimistic, rolled back on failure)', () => {
  it('changes status from the row: only that field is sent, and the row moves to its new group at once', async () => {
    let finish: (v: unknown) => void = () => undefined;
    db.updateTask.mockReturnValue(new Promise((r) => (finish = r)));
    renderList();
    await screen.findByRole('link', { name: 'Behind the scenes' });
    await userEvent.click(first(within(row('Behind the scenes')).getAllByRole('combobox', { name: 'Status' })));
    await userEvent.click(await screen.findByRole('option', { name: /In QC/ }));
    expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.three, { status: 'IN_QC' });
    // before the server answers
    expect(screen.getByRole('group', { name: 'In QC, 1' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /^To do/ })).not.toBeInTheDocument();
    finish({ ...makeDetail({ id: TASK_IDS.three }), updatedAt: 'now' });
    // a field edit does not refetch the whole list
    await waitFor(() => expect(db.listTasks).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('where')).toHaveTextContent(new RegExp(`${LIST_URL}$`)); // did not open the task
  });

  it('a refused change puts the row back where it was and says why', async () => {
    db.updateTask.mockRejectedValue(new Error('You do not have permission to update the task.'));
    renderList();
    await screen.findByRole('link', { name: 'Behind the scenes' });
    await userEvent.click(first(within(row('Behind the scenes')).getAllByRole('combobox', { name: 'Status' })));
    await userEvent.click(await screen.findByRole('option', { name: /Closed/ }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('You do not have permission to update the task.'));
    expect(await screen.findByRole('group', { name: 'To do, 1' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /^Closed/ })).not.toBeInTheDocument();
  });

  it('assigns the editor and the QC reviewer from the row with a searchable picker', async () => {
    renderList();
    await screen.findByRole('link', { name: 'Behind the scenes' });
    await userEvent.click(first(within(row('Behind the scenes')).getAllByRole('combobox', { name: 'Editor: unassigned' })));
    await userEvent.type(screen.getByPlaceholderText('Search people...'), 'eva');
    await userEvent.click(screen.getByRole('option', { name: /Eva Editor/ }));
    await waitFor(() => expect(db.setTaskAssignee).toHaveBeenCalledWith(TASK_IDS.three, 'EDITOR', PEOPLE.editor2));
    expect(first(within(row('Behind the scenes')).getAllByRole('combobox', { name: 'Editor: Eva Editor' }))).toBeInTheDocument();
  });

  it('changes priority and a deadline from the row', async () => {
    renderList();
    await screen.findByRole('link', { name: 'Behind the scenes' });
    await userEvent.click(first(within(row('Behind the scenes')).getAllByRole('combobox', { name: 'Priority' })));
    await userEvent.click(await screen.findByRole('option', { name: /Urgent/ }));
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.three, { priority: 'URGENT' }));
    await userEvent.click(first(within(row('Behind the scenes')).getAllByRole('button', { name: 'Client deadline: not set' })));
    await userEvent.click(await screen.findByRole('button', { name: 'Tomorrow' }));
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.three, { clientDeadline: expect.stringMatching(/T\d\d:00:00\.000Z$/) }));
  });

  it('renames a task in place; Escape cancels', async () => {
    renderList();
    await screen.findByRole('link', { name: 'Behind the scenes' });
    await userEvent.click(within(row('Behind the scenes')).getByRole('button', { name: 'Rename Behind the scenes' }));
    const input = screen.getByLabelText('Rename Behind the scenes');
    await userEvent.type(input, ' (BTS){Escape}');
    expect(db.updateTask).not.toHaveBeenCalled();
    await userEvent.click(within(row('Behind the scenes')).getByRole('button', { name: 'Rename Behind the scenes' }));
    await userEvent.type(screen.getByLabelText('Rename Behind the scenes'), ' (BTS){Enter}');
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.three, { title: 'Behind the scenes (BTS)' }));
  });

  it('expands a row to tick its subtasks without opening the task', async () => {
    renderList();
    await screen.findByRole('link', { name: 'Episode 12 - Founder story' });
    await userEvent.click(screen.getByRole('button', { name: 'Show subtasks of Episode 12 - Founder story' }));
    const box = await screen.findByRole('checkbox', { name: 'Mark done: Captions' });
    await userEvent.click(box);
    await waitFor(() => expect(db.updateSubtask).toHaveBeenCalledWith(TASK_IDS.sub2, { isCompleted: true }));
    expect(db.getTask).toHaveBeenCalledWith(TASK_IDS.one); // loaded only when expanded
  });
});

describe('who can change what, row by row (the database enforces the same)', () => {
  it.each<TbbRole>(['OWNER', 'ADMIN', 'PRODUCTION_MANAGER'])('%s gets every inline control, the row menu and task creation', async (role) => {
    renderList(role);
    const r = await screen.findByRole('link', { name: 'Behind the scenes' }).then((l) => l.closest('li') as HTMLElement);
    for (const name of ['Status', 'Priority', 'Editor: unassigned', 'QC reviewer: unassigned']) {
      expect(within(r).getAllByRole('combobox', { name }).length).toBeGreaterThan(0);
    }
    expect(within(r).getAllByRole('button', { name: /^Internal QC due: / }).length).toBeGreaterThan(0);
    expect(within(r).getByRole('button', { name: 'Actions for Behind the scenes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument();
    expect(screen.getByLabelText('Add a task')).toBeInTheDocument();
  });

  it('an EDITOR can change status only on tasks assigned to them, and nothing else', async () => {
    renderList('EDITOR');
    await screen.findByRole('link', { name: 'Behind the scenes' });
    expect(within(row('Episode 12 - Founder story')).getAllByRole('combobox', { name: 'Status' }).length).toBeGreaterThan(0); // theirs
    expect(within(row('Behind the scenes')).queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument(); // not theirs
    expect(screen.queryByRole('combobox', { name: /^(Editor|QC reviewer):/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Priority' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Internal QC due|Client deadline): / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New task' })).not.toBeInTheDocument();
    // people are still visible, as read-only faces
    expect(within(row('Episode 12 - Founder story')).getAllByRole('img', { name: 'Editor: Pat Person' }).length).toBeGreaterThan(0);
    // and an editor's status menu never offers approval
    await userEvent.click(first(within(row('Episode 12 - Founder story')).getAllByRole('combobox', { name: 'Status' })));
    const enabled = (await screen.findAllByRole('option')).filter((o) => o.getAttribute('aria-disabled') !== 'true').map((o) => o.textContent);
    expect(enabled.join(' ')).not.toMatch(/Ready to deliver|Completed|Closed/);
  });

  it('a QC SPECIALIST changes status on any task (never to Completed / Closed), nothing else', async () => {
    renderList('QC_SPECIALIST');
    await screen.findByRole('link', { name: 'Behind the scenes' });
    expect(within(row('Behind the scenes')).getAllByRole('combobox', { name: 'Status' }).length).toBeGreaterThan(0);
    expect(within(row('Product teaser')).queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument(); // completed: locked
    expect(screen.queryByRole('combobox', { name: 'Priority' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^(Editor|QC reviewer):/ })).not.toBeInTheDocument();
  });

  it('a client viewer gets no task requests at all (fails closed in the UI as in the database)', async () => {
    renderList('CLIENT_VIEWER');
    expect(await screen.findByRole('alert')).toHaveTextContent('No access');
    expect(db.listTasks).not.toHaveBeenCalled();
  });
});

describe('finding work: search, filters, grouping, sorting (remembered per list)', () => {
  it('searches titles and shows "x of y"', async () => {
    renderList();
    await screen.findByRole('link', { name: 'Product teaser' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'teaser');
    expect(screen.getByRole('link', { name: 'Product teaser' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Behind the scenes' })).not.toBeInTheDocument();
    expect(screen.getByText('1 of 3 tasks')).toBeInTheDocument();
  });

  it('"Assigned to me" and "Overdue" answer the two daily questions', async () => {
    renderList();
    await screen.findByRole('link', { name: 'Product teaser' });
    await userEvent.click(screen.getByRole('button', { name: 'Assigned to me' }));
    expect(screen.getAllByRole('listitem').map((li) => within(li).getAllByRole('link')[0].textContent)).toEqual(['Episode 12 - Founder story']);
    await userEvent.click(screen.getByRole('button', { name: 'Assigned to me' }));
    await userEvent.click(screen.getByRole('button', { name: 'Overdue' }));
    expect(screen.getByText('1 of 3 tasks')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Episode 12 - Founder story' })).toBeInTheDocument();
  });

  it('filters by status, people and priority, explains an empty result, and clears', async () => {
    renderList();
    await screen.findByRole('link', { name: 'Product teaser' });
    await userEvent.click(screen.getByRole('button', { name: 'Priority filter' }));
    await userEvent.click(await screen.findByRole('option', { name: /Urgent/ }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('1 of 3 tasks')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^People filter/ }));
    await userEvent.click(await screen.findByRole('option', { name: /Nobody assigned/ }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('No tasks match these filters.')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /Clear filters/ })[0]);
    expect(screen.getByText('3 tasks')).toBeInTheDocument();
  });

  it('groups by editor, by priority or not at all; collapses a group; remembers the choice for this list', async () => {
    const { unmount } = renderList();
    await screen.findByRole('link', { name: 'Product teaser' });
    await userEvent.click(screen.getByRole('button', { name: /^Group: / }));
    await userEvent.click(screen.getByRole('option', { name: 'Editor' }));
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Eva Editor, 1', 'Pat Person, 1', 'No editor, 1']);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Pat Person' }));
    expect(screen.queryByRole('link', { name: 'Episode 12 - Founder story' })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(taskViewStorageKey(IDS.listEdaptx))).toMatch(/"groupBy":"editor"/);
    unmount();
    renderList();
    await screen.findByRole('link', { name: 'Product teaser' });
    expect(screen.getByRole('group', { name: 'Pat Person, 1' })).toBeInTheDocument(); // remembered
    expect(screen.queryByRole('link', { name: 'Episode 12 - Founder story' })).not.toBeInTheDocument(); // still collapsed
  });

  it('sorts within groups, and offers manual move up / down only when the screen shows the manual order', async () => {
    renderList();
    await screen.findByRole('link', { name: 'Product teaser' });
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Behind the scenes' }));
    expect(screen.queryByRole('menuitem', { name: /Move up/ })).not.toBeInTheDocument(); // grouped: no manual moves
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: /^Group: / }));
    await userEvent.click(screen.getByRole('option', { name: 'No grouping' }));
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Product teaser' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Move up/ }));
    await waitFor(() => expect(db.moveTask).toHaveBeenCalledWith(TASK_IDS.two, 'up'));
    await userEvent.click(screen.getByRole('button', { name: /^Sort: / }));
    await userEvent.click(screen.getByRole('option', { name: 'Title' }));
    const titles = within(screen.getByRole('list', { name: 'Tasks in 25. EDAPTX' })).getAllByRole('listitem').map((li) => within(li).getAllByRole('link')[0].textContent);
    expect(titles).toEqual(['Behind the scenes', 'Episode 12 - Founder story', 'Product teaser']);
  });
});

describe('many at once: selection and bulk actions', () => {
  it('selects with checkboxes, shift-click ranges and "select all in group", then changes status in bulk', async () => {
    renderList();
    await screen.findByRole('link', { name: 'Product teaser' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Behind the scenes' }));
    const user = userEvent.setup();
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('checkbox', { name: 'Select Product teaser' }));
    await user.keyboard('{/Shift}');
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(bar).toHaveTextContent('3 selected');
    await userEvent.click(within(bar).getByRole('combobox', { name: 'Set status for selected tasks' }));
    await userEvent.click(await screen.findByRole('option', { name: /In QC/ }));
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledTimes(3));
    for (const id of [TASK_IDS.one, TASK_IDS.two, TASK_IDS.three]) expect(db.updateTask).toHaveBeenCalledWith(id, { status: 'IN_QC' });
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Updated 3 tasks'));
    expect(screen.getByRole('group', { name: 'In QC, 3' })).toBeInTheDocument();
  });

  it('a bulk change only touches the tasks the person may change, and says how many were skipped', async () => {
    renderList('EDITOR');
    await screen.findByRole('link', { name: 'Product teaser' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all in To do' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all in In progress' }));
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(within(bar).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    expect(within(bar).queryByRole('combobox', { name: /priority/ })).not.toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('combobox', { name: 'Set status for selected tasks' }));
    await userEvent.click(await screen.findByRole('option', { name: /In QC/ }));
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledTimes(1));
    expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { status: 'IN_QC' }); // only their own task
    await waitFor(() => expect(toasts.message).toHaveBeenCalledWith(expect.stringMatching(/1 selected task was skipped/)));
  });

  it('when some bulk writes fail, exactly those rows go back and the person is told', async () => {
    db.updateTask.mockImplementation(async (id: string) => {
      if (id === TASK_IDS.three) throw new Error('You do not have permission to update the task.');
      return { ...makeDetail({ id }), updatedAt: 'now' };
    });
    renderList();
    await screen.findByRole('link', { name: 'Product teaser' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Behind the scenes' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Episode 12 - Founder story' }));
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    await userEvent.click(within(bar).getByRole('combobox', { name: 'Set priority for selected tasks' }));
    await userEvent.click(await screen.findByRole('option', { name: /Low/ }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(expect.stringMatching(/Updated 1 task; 1 task could not be changed/)));
    expect(first(within(row('Behind the scenes')).getAllByRole('combobox', { name: 'Priority' }))).toHaveTextContent(/Normal/);
    expect(first(within(row('Episode 12 - Founder story')).getAllByRole('combobox', { name: 'Priority' }))).toHaveTextContent(/Low/);
  });

  it('bulk delete asks first, then deletes each selected task', async () => {
    renderList();
    await screen.findByRole('link', { name: 'Product teaser' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Behind the scenes' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Product teaser' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Bulk actions' })).getByRole('button', { name: /Delete/ }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Delete 2 tasks?');
    expect(db.deleteTask).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(db.deleteTask).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument());
  });
});

describe('keyboard', () => {
  it('/ searches, J/K move, X selects, Enter opens, Esc clears the selection', async () => {
    renderList();
    await screen.findByRole('link', { name: 'Product teaser' });
    await userEvent.keyboard('/');
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('jj');
    await userEvent.keyboard('x');
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('1 selected');
    expect(screen.getByRole('checkbox', { name: 'Select Episode 12 - Founder story' })).toBeChecked(); // second visible row
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`${LIST_URL}/tasks/${TASK_IDS.one}`));
  });

  it('N jumps to quick add for people who can create', async () => {
    renderList();
    await screen.findByRole('link', { name: 'Product teaser' });
    await userEvent.keyboard('n');
    expect(screen.getByLabelText('Add a task')).toHaveFocus();
  });
});

describe('quick add', () => {
  it('adds a task from just a title and keeps the field ready for the next one', async () => {
    db.createTask.mockResolvedValue({ id: 'new', title: 'Next clip' });
    renderList();
    const input = await screen.findByLabelText('Add a task');
    await userEvent.type(input, 'Next clip{Enter}');
    await waitFor(() => expect(db.createTask).toHaveBeenCalledWith(IDS.listEdaptx, { title: 'Next clip' }));
    await waitFor(() => expect(input).toHaveValue(''));
    // creating changes which rows exist, so the list is refreshed from the database
    await waitFor(() => expect(db.listTasks.mock.calls.length).toBeGreaterThan(1));
  });

  it('adding inside a status group creates the task there', async () => {
    db.createTask.mockResolvedValue({ id: 'new-task', title: 'Teaser v2' });
    renderList();
    await screen.findByRole('link', { name: 'Product teaser' });
    await userEvent.click(screen.getByRole('button', { name: 'Add a task to In progress' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Add a task to In progress' }), 'Teaser v2{Enter}');
    await waitFor(() => expect(db.createTask).toHaveBeenCalledWith(IDS.listEdaptx, { title: 'Teaser v2' }));
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith('new-task', { status: 'IN_PROGRESS' }));
  });

  it('refuses a blank title and keeps what was typed when the save fails', async () => {
    renderList();
    const input = await screen.findByLabelText('Add a task');
    await userEvent.type(input, '   {Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a task title.');
    db.createTask.mockRejectedValue(new Error('You do not have permission to create the task.'));
    await userEvent.clear(input);
    await userEvent.type(input, 'Precious title{Enter}');
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('You do not have permission to create the task.'));
    expect(input).toHaveValue('Precious title');
  });
});

describe('New task dialog', () => {
  const open = async () => {
    renderList();
    await screen.findByRole('link', { name: 'Product teaser' });
    await userEvent.click(screen.getByRole('button', { name: 'New task' }));
    return screen.findByRole('dialog');
  };

  it('validates the title and every link before sending anything', async () => {
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText('Raw footage'), 'drive.google.com/x');
    await userEvent.type(within(dialog).getByLabelText('Review link'), 'javascript:alert(1)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(await within(dialog).findByText('Enter a task title.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Raw footage: Enter a full link/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Review link: Enter a full link/)).toBeInTheDocument();
    expect(db.createTask).not.toHaveBeenCalled();
  });

  it('creates the task with the full brief, then opens it', async () => {
    db.createTask.mockResolvedValue({ id: TASK_IDS.three, title: 'Episode 13' });
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Episode 13');
    await userEvent.type(within(dialog).getByLabelText('Brief'), 'Hook first');
    await userEvent.type(within(dialog).getByLabelText('Raw footage'), 'https://drive.google.com/x');
    await userEvent.type(within(dialog).getByLabelText('Internal QC due'), '2026-10-10');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Editor' }));
    await userEvent.click(await screen.findByRole('option', { name: /Eva Editor/ }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'QC reviewer' }));
    await userEvent.click(await screen.findByRole('option', { name: /Quinn QC/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(db.createTask).toHaveBeenCalledTimes(1));
    expect(db.createTask.mock.calls[0][1]).toMatchObject({ title: 'Episode 13', description: 'Hook first', editorId: PEOPLE.editor2, qcId: PEOPLE.qc });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`${LIST_URL}/tasks/${TASK_IDS.three}`));
  });

  it('never offers the editor as their own QC reviewer', async () => {
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Editor' }));
    await userEvent.click(await screen.findByRole('option', { name: /Eva Editor/ }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'QC reviewer' }));
    const names = (await screen.findAllByRole('option')).map((o) => o.textContent ?? '');
    expect(names.some((n) => /Eva Editor/.test(n))).toBe(false);
    expect(names.some((n) => /Quinn QC/.test(n))).toBe(true);
  });

  it('shows the database refusal inside the dialog and keeps the form', async () => {
    db.createTask.mockRejectedValue(new Error('You do not have permission to create the task.'));
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Episode 14');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(await within(dialog).findByText('You do not have permission to create the task.')).toBeInTheDocument();
  });
});

describe('deleting one task', () => {
  it('asks first, says what goes with it, and deletes only after confirmation', async () => {
    renderList();
    await screen.findByRole('link', { name: 'Episode 12 - Founder story' });
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Episode 12 - Founder story' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete task/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('its 4 subtasks');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(db.deleteTask).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Episode 12 - Founder story' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete task/ }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(db.deleteTask).toHaveBeenCalledWith(TASK_IDS.one));
  });
});

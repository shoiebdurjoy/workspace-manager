import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import ListPage from '@/pages/ListPage';
import { makeAuth, renderWithAuth } from '@/test/auth-utils';
import type { createDatabaseMock } from '@/test/database-mock';
import * as dbModule from '@/database';
import { IDS, makeTree } from '@/test/hierarchy-fixtures';
import { MEMBERS, PEOPLE, TASK_IDS, makeDetail, makeSummary } from '@/test/task-fixtures';
import type { TbbRole } from '@/types/database';

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
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
const renderList = (role: TbbRole = 'PRODUCTION_MANAGER') =>
  renderWithAuth(routes, { auth: makeAuth(role), route: LIST_URL });

const ROWS = [
  makeSummary({
    id: TASK_IDS.one, title: 'Episode 12 - Founder story', status: 'IN_PROGRESS', priority: 'URGENT', aspectRatio: '9:16',
    dueDate: '2020-01-02T12:00:00.000Z', clientDeadline: '2099-01-02T12:00:00.000Z', editorId: PEOPLE.me, qcId: PEOPLE.qc,
    subtaskTotal: 4, subtaskDone: 1, position: 0,
  }),
  makeSummary({ id: TASK_IDS.two, title: 'Product teaser', status: 'COMPLETED', priority: 'LOW', position: 1 }),
  makeSummary({ id: TASK_IDS.three, title: 'Behind the scenes', status: 'TODO', position: 2 }),
];

beforeEach(() => {
  vi.clearAllMocks();
  db.getWorkspaceHierarchy.mockResolvedValue(makeTree());
  db.getWorkspaceMembers.mockResolvedValue(MEMBERS);
  db.listInvitations.mockResolvedValue([]);
  db.listTeams.mockResolvedValue([]);
  db.listTeamMembers.mockResolvedValue([]);
  db.listTasks.mockResolvedValue({ items: ROWS, total: 3 });
  db.getTask.mockResolvedValue(makeDetail());
});

describe('task list: real data in the list page', () => {
  it('shows every task from the database with status, people, deadlines, checklist progress and a link to open it', async () => {
    renderList();
    const list = await screen.findByRole('list', { name: 'Tasks in 25. EDAPTX' });
    expect(db.listTasks).toHaveBeenCalledWith(IDS.listEdaptx, 0);
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);

    const first = rows[0];
    const link = within(first).getByRole('link', { name: 'Episode 12 - Founder story' });
    expect(link).toHaveAttribute('href', `${LIST_URL}/tasks/${TASK_IDS.one}`);
    expect(first).toHaveTextContent('In progress');
    expect(within(first).getAllByLabelText('Editor: Pat Person').length).toBeGreaterThan(0);
    expect(within(first).getAllByLabelText('QC: Quinn QC').length).toBeGreaterThan(0);
    expect(within(first).getAllByLabelText('1 of 4 subtasks done').length).toBeGreaterThan(0);
    expect(within(first).getAllByText('9:16').length).toBeGreaterThan(0);
    expect(within(first).getAllByText(/Internal QC due:/).length).toBeGreaterThan(0);
    expect(within(first).getAllByText(/\(overdue\)/).length).toBeGreaterThan(0); // 2020 QC date, unfinished
    expect(within(first).getAllByText(/Urgent priority/).length).toBeGreaterThan(0);

    // a finished task is never flagged overdue and reads as done
    expect(within(rows[1]).getByRole('link', { name: 'Product teaser' }).className).toMatch(/line-through/);
    expect(within(rows[1]).queryByText(/overdue/)).not.toBeInTheDocument();
    // unassigned slots are shown as such, not hidden
    expect(within(rows[2]).getAllByLabelText('Editor: unassigned').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: /Tasks/ })).toHaveTextContent('3');
  });

  it('highlights the task whose sheet is open', async () => {
    renderWithAuth(routes, { auth: makeAuth('OWNER'), route: `${LIST_URL}/tasks/${TASK_IDS.two}` });
    // the open sheet is modal, so the list behind it is hidden from the accessibility tree
    const link = await screen.findByRole('link', { name: 'Product teaser', hidden: true });
    expect(link).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: 'Behind the scenes', hidden: true })).not.toHaveAttribute('aria-current');
  });

  it('shows a loading state, then the tasks', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    db.listTasks.mockReturnValue(new Promise((r) => (resolve = r)));
    renderList();
    expect(await screen.findByRole('status', { name: 'Loading tasks' })).toBeInTheDocument();
    resolve({ items: ROWS, total: 3 });
    expect(await screen.findByRole('link', { name: 'Product teaser' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading tasks' })).not.toBeInTheDocument();
  });

  it('shows a readable error with Try again that really retries', async () => {
    db.listTasks.mockRejectedValueOnce(new Error('Failed to load the tasks: connection failure'));
    renderList();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The tasks could not be loaded');
    expect(alert).toHaveTextContent('connection failure');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('link', { name: 'Product teaser' })).toBeInTheDocument();
    expect(db.listTasks).toHaveBeenCalledTimes(2);
  });

  it('an empty list has a designed empty state (no invented tasks); managers can start from it', async () => {
    db.listTasks.mockResolvedValue({ items: [], total: 0 });
    renderList('PRODUCTION_MANAGER');
    expect(await screen.findByText('No tasks in this list yet')).toBeInTheDocument();
    expect(screen.getByLabelText('Add a task')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New task' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it.each<TbbRole>(['EDITOR', 'QC_SPECIALIST'])('an empty list for a %s offers no way to create', async (role) => {
    db.listTasks.mockResolvedValue({ items: [], total: 0 });
    renderList(role);
    expect(await screen.findByText('No tasks in this list yet')).toBeInTheDocument();
    expect(screen.getByText(/added to this list by a Production Manager/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Add a task')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New task' })).not.toBeInTheDocument();
  });

  it('loads the next page only when asked', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) =>
      makeSummary({ id: `cccccccc-cccc-4ccc-8ccc-${String(i).padStart(12, '0')}`, title: `Clip ${i}`, position: i })
    );
    db.listTasks.mockImplementation(async (_list: string, page: number) =>
      page === 0
        ? { items: page1, total: 103 }
        : { items: [makeSummary({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd01', title: 'Clip 100', position: 100 })], total: 103 }
    );
    renderList();
    await screen.findByRole('link', { name: 'Clip 0' });
    expect(db.listTasks).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /Show more \(3 more\)/ }));
    expect(await screen.findByRole('link', { name: 'Clip 100' })).toBeInTheDocument();
    expect(db.listTasks).toHaveBeenLastCalledWith(IDS.listEdaptx, 1);
  });
});

describe('who sees which controls', () => {
  it.each<TbbRole>(['OWNER', 'ADMIN', 'PRODUCTION_MANAGER'])('%s can create, reorder and delete', async (role) => {
    renderList(role);
    await screen.findByRole('link', { name: 'Product teaser' });
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument();
    expect(screen.getByLabelText('Add a task')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Product teaser' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Move up/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Delete task/ })).toBeInTheDocument();
  });

  it.each<TbbRole>(['EDITOR', 'QC_SPECIALIST'])('%s can read tasks but not create, reorder or delete them', async (role) => {
    renderList(role);
    await screen.findByRole('link', { name: 'Product teaser' });
    expect(screen.queryByRole('button', { name: 'New task' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add a task')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument();
  });

  it('a client viewer gets no task requests at all (fails closed in the UI as in the database)', async () => {
    renderList('CLIENT_VIEWER');
    expect(await screen.findByRole('alert')).toHaveTextContent('No access');
    expect(db.listTasks).not.toHaveBeenCalled();
  });
});

describe('quick add', () => {
  it('adds a task from just a title, clears the field, and keeps it ready for the next one', async () => {
    db.createTask.mockResolvedValue({ id: 'new', title: 'Next clip' });
    renderList();
    const input = await screen.findByLabelText('Add a task');
    await userEvent.type(input, '  Next clip  {Enter}');
    await waitFor(() => expect(db.createTask).toHaveBeenCalledWith(IDS.listEdaptx, { title: '  Next clip  ' }));
    await waitFor(() => expect(input).toHaveValue(''));
    expect(input).toHaveFocus();
    expect(toasts.success).toHaveBeenCalledWith('Task "Next clip" created');
    // the list is refreshed from the database, not patched locally
    await waitFor(() => expect(db.listTasks.mock.calls.length).toBeGreaterThan(1));
  });

  it('refuses a blank title with a message and sends nothing', async () => {
    renderList();
    await userEvent.type(await screen.findByLabelText('Add a task'), '   {Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a task title.');
    expect(db.createTask).not.toHaveBeenCalled();
  });

  it('keeps what was typed when the save fails, and says why', async () => {
    db.createTask.mockRejectedValue(new Error('You do not have permission to create the task.'));
    renderList();
    const input = await screen.findByLabelText('Add a task');
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
    expect(within(dialog).getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true');
  });

  it('creates the task with the full brief, then opens it', async () => {
    db.createTask.mockResolvedValue({ id: TASK_IDS.three, title: 'Episode 13' });
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Episode 13');
    await userEvent.type(within(dialog).getByLabelText('Brief'), 'Hook first');
    await userEvent.type(within(dialog).getByLabelText('Raw footage'), 'https://drive.google.com/x');
    await userEvent.type(within(dialog).getByLabelText('Internal QC due'), '2026-10-10');
    await userEvent.type(within(dialog).getByLabelText('Client deadline'), '2026-10-20');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Editor' }));
    await userEvent.click(await screen.findByRole('option', { name: /Eva Editor/ }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'QC reviewer' }));
    await userEvent.click(await screen.findByRole('option', { name: /Quinn QC/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));

    await waitFor(() => expect(db.createTask).toHaveBeenCalledTimes(1));
    const [listId, input] = db.createTask.mock.calls[0];
    expect(listId).toBe(IDS.listEdaptx);
    expect(input).toMatchObject({
      title: 'Episode 13',
      description: 'Hook first',
      priority: 'MEDIUM',
      aspectRatio: null,
      rawFootageLink: 'https://drive.google.com/x',
      editorId: PEOPLE.editor2,
      qcId: PEOPLE.qc,
    });
    expect(input.dueDate).toMatch(/^2026-10-10T/);
    expect(input.clientDeadline).toMatch(/^2026-10-20T/);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`${LIST_URL}/tasks/${TASK_IDS.three}`));
  });

  it('never offers the editor as their own QC reviewer, or a client / QC specialist as editor', async () => {
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Editor' }));
    await userEvent.click(await screen.findByRole('option', { name: /Eva Editor/ }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'QC reviewer' }));
    const options = await screen.findAllByRole('option');
    const names = options.map((o) => o.textContent ?? '');
    expect(names.some((n) => /Eva Editor/.test(n))).toBe(false); // already the editor
    expect(names.some((n) => /Pat Person/.test(n))).toBe(false); // an editor cannot QC
    expect(names.some((n) => /Quinn QC/.test(n))).toBe(true);
    expect(names.some((n) => /Mia Manager/.test(n))).toBe(true);
  });

  it('warns softly when the QC date is after the client deadline, and still allows saving', async () => {
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText('Internal QC due'), '2026-10-25');
    await userEvent.type(within(dialog).getByLabelText('Client deadline'), '2026-10-20');
    expect(within(dialog).getByRole('status')).toHaveTextContent(/after the client deadline/);
    expect(within(dialog).getByRole('button', { name: 'Create task' })).toBeEnabled();
  });

  it('shows the database refusal inside the dialog and keeps the form', async () => {
    db.createTask.mockRejectedValue(new Error('You do not have permission to create the task.'));
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Episode 14');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(await within(dialog).findByText('You do not have permission to create the task.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Episode 14');
  });
});

describe('ordering and deleting from the list', () => {
  it('moves a task with the row menu; the first row cannot move up and the last cannot move down', async () => {
    db.moveTask.mockResolvedValue(true);
    renderList();
    await screen.findByRole('link', { name: 'Product teaser' });

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Episode 12 - Founder story' }));
    expect(await screen.findByRole('menuitem', { name: /Move up/ })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Behind the scenes' }));
    expect(await screen.findByRole('menuitem', { name: /Move down/ })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Product teaser' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Move up/ }));
    await waitFor(() => expect(db.moveTask).toHaveBeenCalledWith(TASK_IDS.two, 'up'));
  });

  it('asks before deleting, says what goes with the task, and deletes only after confirmation', async () => {
    db.deleteTask.mockResolvedValue(undefined);
    renderList();
    await screen.findByRole('link', { name: 'Episode 12 - Founder story' });

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Episode 12 - Founder story' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete task/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete task "Episode 12 - Founder story"?');
    expect(dialog).toHaveTextContent('its 4 subtasks');
    expect(dialog).toHaveTextContent('cannot be undone');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(db.deleteTask).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Episode 12 - Founder story' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete task/ }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(db.deleteTask).toHaveBeenCalledWith(TASK_IDS.one));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('keeps the confirmation open when the delete fails, so it can be retried or cancelled', async () => {
    db.deleteTask.mockRejectedValue(new Error('You do not have permission to delete the task.'));
    renderList();
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Product teaser' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete task/ }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('You do not have permission to delete the task.'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});

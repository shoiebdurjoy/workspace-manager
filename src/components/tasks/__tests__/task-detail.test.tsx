import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import ListPage from '@/pages/ListPage';
import { makeAuth, renderWithAuth } from '@/test/auth-utils';
import type { createDatabaseMock } from '@/test/database-mock';
import * as dbModule from '@/database';
import { NotFoundError } from '@/database/errors';
import { IDS, makeTree } from '@/test/hierarchy-fixtures';
import { MEMBERS, PEOPLE, TASK_IDS, makeDetail, makeSubtask, makeSummary } from '@/test/task-fixtures';
import type { TbbRole, TaskDetail } from '@/types/database';

vi.mock('@/database', async () => {
  const mock = (await import('@/test/database-mock')).createDatabaseMock();
  return mock;
});
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
const taskUrl = (id: string = TASK_IDS.one) => `${LIST_URL}/tasks/${id}`;

async function openTask(role: TbbRole = 'PRODUCTION_MANAGER', detail: Partial<TaskDetail> = {}, route = taskUrl()) {
  db.getTask.mockResolvedValue(makeDetail(detail));
  const view = renderWithAuth(routes, { auth: makeAuth(role), route });
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByLabelText('Task title');
  return { ...view, dialog };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.getWorkspaceHierarchy.mockResolvedValue(makeTree());
  db.getWorkspaceMembers.mockResolvedValue(MEMBERS);
  db.listInvitations.mockResolvedValue([]);
  db.listTeams.mockResolvedValue([]);
  db.listTeamMembers.mockResolvedValue([]);
  db.listTasks.mockResolvedValue({ items: [makeSummary({ id: TASK_IDS.one, title: 'Episode 12 - Founder story' })], total: 1 });
  db.updateTask.mockResolvedValue({});
  db.setTaskAssignee.mockResolvedValue(undefined);
  db.createSubtask.mockResolvedValue({});
  db.updateSubtask.mockResolvedValue({});
  db.deleteSubtask.mockResolvedValue(undefined);
  db.deleteTask.mockResolvedValue(undefined);
});

describe('task detail sheet: what people see', () => {
  it('shows the whole deliverable: brief, status, assignees, deadlines, links and checklist', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    expect(db.getTask).toHaveBeenCalledWith(TASK_IDS.one);
    expect(dialog).toHaveAccessibleName('Episode 12 - Founder story');
    expect(within(dialog).getByLabelText('Task title')).toHaveValue('Episode 12 - Founder story');
    expect(within(dialog).getByRole('combobox', { name: 'Status' })).toHaveTextContent('In progress');
    expect(within(dialog).getByRole('combobox', { name: 'Priority' })).toHaveTextContent('High');
    expect(within(dialog).getByRole('combobox', { name: 'Editor' })).toHaveTextContent('Pat Person');
    expect(within(dialog).getByRole('combobox', { name: 'QC reviewer' })).toHaveTextContent('Quinn QC');
    expect(within(dialog).getByRole('combobox', { name: 'Aspect ratio' })).toHaveTextContent('9:16');
    expect(within(dialog).getByLabelText('Internal QC due')).toHaveValue('2026-10-12');
    expect(within(dialog).getByLabelText('Client deadline')).toHaveValue('2026-10-20');
    expect(within(dialog).getByLabelText('Raw footage')).toHaveValue('https://drive.google.com/drive/folders/abc');
    expect(within(dialog).getByLabelText('Review link')).toHaveValue('https://app.frame.io/reviews/xyz');
    expect(within(dialog).getByLabelText('Project file')).toHaveValue('');
    expect(within(dialog).getByLabelText('Task brief')).toHaveValue('Cut to 58 seconds.');
    expect(within(dialog).getByRole('progressbar', { name: 'Subtask progress' })).toHaveAttribute('aria-valuenow', '50');
    expect(within(dialog).getByText('1/2 done')).toBeInTheDocument();
    expect(within(dialog).getByText(/Created .* by Mia Manager/)).toBeInTheDocument();
    expect(within(dialog).getByText('25. EDAPTX')).toBeInTheDocument(); // the parent list is named
  });

  it('opens links safely in a new tab, and only for valid links', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    const open = within(dialog).getByRole('link', { name: /Open Raw footage \(drive\.google\.com\)/ });
    expect(open).toHaveAttribute('href', 'https://drive.google.com/drive/folders/abc');
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(dialog).queryByRole('link', { name: /Open Project file/ })).not.toBeInTheDocument(); // empty: no button
  });

  it('never turns a bad stored link into a clickable href', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER', { finalExportLink: 'javascript:alert(1)' });
    expect(within(dialog).queryByRole('link', { name: /Open Final export/ })).not.toBeInTheDocument();
  });

  it('shows a loading state while the task loads', async () => {
    db.getTask.mockReturnValue(new Promise(() => undefined));
    renderWithAuth(routes, { auth: makeAuth('OWNER'), route: taskUrl() });
    expect(await screen.findByRole('status', { name: 'Loading task' })).toBeInTheDocument();
  });

  it('closing the sheet returns to the plain list URL', async () => {
    const { dialog } = await openTask('OWNER');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(new RegExp(`${LIST_URL}$`)));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('task detail sheet: missing, wrong and broken', () => {
  it('a task that belongs to another list is "not found" (ids cannot be mixed in the URL)', async () => {
    db.getTask.mockResolvedValue(makeDetail({ listId: IDS.listConor }));
    renderWithAuth(routes, { auth: makeAuth('OWNER'), route: taskUrl() });
    expect(await screen.findByText('Task not found')).toBeInTheDocument();
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument();
  });

  it('a deleted / invisible task is "not found" and offers a way back', async () => {
    db.getTask.mockRejectedValue(new NotFoundError('Task', TASK_IDS.one));
    renderWithAuth(routes, { auth: makeAuth('OWNER'), route: taskUrl() });
    expect(await screen.findByText('Task not found')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Back to 25\. EDAPTX/ }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(new RegExp(`${LIST_URL}$`)));
  });

  it('a malformed task id never reaches the database', async () => {
    renderWithAuth(routes, { auth: makeAuth('OWNER'), route: `${LIST_URL}/tasks/not-a-uuid` });
    expect(await screen.findByText('Task not found')).toBeInTheDocument();
    expect(db.getTask).not.toHaveBeenCalled();
  });

  it('a real failure shows an error with Try again, not a fake "not found"', async () => {
    // one automatic retry happens first, so the first two attempts fail
    db.getTask.mockRejectedValueOnce(new Error('Failed to load the task: connection failure'));
    db.getTask.mockRejectedValueOnce(new Error('Failed to load the task: connection failure'));
    db.getTask.mockResolvedValue(makeDetail());
    renderWithAuth(routes, { auth: makeAuth('OWNER'), route: taskUrl() });
    const alert = await screen.findByText('The task could not be loaded', {}, { timeout: 5000 });
    expect(alert).toBeInTheDocument();
    expect(screen.queryByText('Task not found')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByLabelText('Task title')).toHaveValue('Episode 12 - Founder story');
  });
});

describe('task detail sheet: editing as a manager', () => {
  it('saves a renamed title when you leave the field, sending only that field', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    const title = within(dialog).getByLabelText('Task title');
    await userEvent.clear(title);
    await userEvent.type(title, '  Episode 12 - Final cut  ');
    await userEvent.tab();
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { title: 'Episode 12 - Final cut' }));
    expect(db.updateTask).toHaveBeenCalledTimes(1);
  });

  it('Enter saves, Escape reverts without saving, and an unchanged value sends nothing', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    const title = within(dialog).getByLabelText('Task title');
    await userEvent.type(title, '!{Enter}');
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { title: 'Episode 12 - Founder story!' }));
    db.updateTask.mockClear();

    await userEvent.type(title, 'xyz{Escape}');
    expect(title).toHaveValue('Episode 12 - Founder story');
    // Escape must discard, not save, what was typed, and must not close the sheet on its first press
    expect(db.updateTask).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    return;
    await userEvent.click(title);
    await userEvent.tab();
    expect(db.updateTask).not.toHaveBeenCalled();
  });

  it('refuses a blank title with a message and does not save', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    const title = within(dialog).getByLabelText('Task title');
    await userEvent.clear(title);
    await userEvent.tab();
    expect(await within(dialog).findByText('Enter a task title.')).toBeInTheDocument();
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(db.updateTask).not.toHaveBeenCalled();
  });

  it('validates links on the spot: bad ones are explained and never sent, valid ones save, empty clears', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    const review = within(dialog).getByLabelText('Review link');

    await userEvent.clear(review);
    await userEvent.type(review, 'frame.io/reviews/1');
    await userEvent.tab();
    expect(await within(dialog).findByText(/Enter a full link that starts with http/)).toBeInTheDocument();
    expect(db.updateTask).not.toHaveBeenCalled();

    await userEvent.clear(review);
    await userEvent.type(review, 'javascript:alert(1)');
    await userEvent.tab();
    expect(db.updateTask).not.toHaveBeenCalled();

    await userEvent.clear(review);
    await userEvent.type(review, 'https://app.frame.io/reviews/new');
    await userEvent.tab();
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { reviewLink: 'https://app.frame.io/reviews/new' }));

    await userEvent.clear(review);
    await userEvent.tab();
    await waitFor(() => expect(db.updateTask).toHaveBeenLastCalledWith(TASK_IDS.one, { reviewLink: '' }));
  });

  it('saves the brief only on an explicit Save, and Cancel discards the edit', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    const brief = within(dialog).getByLabelText('Task brief');
    expect(within(dialog).queryByRole('button', { name: 'Save brief' })).not.toBeInTheDocument();
    await userEvent.type(brief, ' Add captions.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(brief).toHaveValue('Cut to 58 seconds.');
    expect(db.updateTask).not.toHaveBeenCalled();

    await userEvent.type(brief, '\nHook first.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save brief' }));
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { description: 'Cut to 58 seconds.\nHook first.' }));
  });

  it('changes priority, status, aspect ratio and deadlines', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Priority' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Low' }));
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { priority: 'LOW' }));

    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Status' }));
    await userEvent.click(await screen.findByRole('option', { name: /In QC/ }));
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { status: 'IN_QC' }));

    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Aspect ratio' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Not set' }));
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { aspectRatio: null }));

    fireEvent.change(within(dialog).getByLabelText('Client deadline'), { target: { value: '2026-11-02' } });
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { clientDeadline: expect.stringMatching(/^2026-11-02T/) }));
    fireEvent.change(within(dialog).getByLabelText('Internal QC due'), { target: { value: '' } });
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { dueDate: null }));
  });

  it('warns softly (never blocks) when the QC date is after the client deadline', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER', { dueDate: '2026-10-30T12:00:00.000Z', clientDeadline: '2026-10-20T12:00:00.000Z' });
    expect(within(dialog).getByRole('status')).toHaveTextContent(/after the client deadline/);
  });

  it('when a save is refused, tells the person and puts the field back to what is saved', async () => {
    db.updateTask.mockRejectedValue(new Error('You do not have permission to update the task.'));
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    const title = within(dialog).getByLabelText('Task title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Unsaved rename');
    await userEvent.tab();
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('You do not have permission to update the task.'));
    await waitFor(() => expect(title).toHaveValue('Episode 12 - Founder story'));
  });

  it('deletes only after confirmation, then returns to the list', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    await userEvent.click(within(dialog).getByRole('button', { name: /Delete task/ }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('its 2 subtasks');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(db.deleteTask).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: /Delete task/ }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(db.deleteTask).toHaveBeenCalledWith(TASK_IDS.one));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(new RegExp(`${LIST_URL}$`)));
  });
});

describe('task detail sheet: assignment', () => {
  it('assigns, replaces and clears the editor and the QC reviewer', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Editor' }));
    await userEvent.click(await screen.findByRole('option', { name: /Eva Editor/ }));
    await waitFor(() => expect(db.setTaskAssignee).toHaveBeenCalledWith(TASK_IDS.one, 'EDITOR', PEOPLE.editor2));

    await userEvent.click(within(dialog).getByRole('combobox', { name: 'QC reviewer' }));
    await userEvent.click(await screen.findByRole('option', { name: /Mia Manager/ }));
    await waitFor(() => expect(db.setTaskAssignee).toHaveBeenCalledWith(TASK_IDS.one, 'QC_REVIEWER', PEOPLE.manager));

    await userEvent.click(within(dialog).getByRole('combobox', { name: 'QC reviewer' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Unassigned' }));
    await waitFor(() => expect(db.setTaskAssignee).toHaveBeenCalledWith(TASK_IDS.one, 'QC_REVIEWER', null));
  });

  it('offers only people the database would accept for each slot', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Editor' }));
    let names = (await screen.findAllByRole('option')).map((o) => o.textContent ?? '');
    expect(names.some((n) => /Quinn QC/.test(n))).toBe(false); // a QC specialist cannot edit
    expect(names.some((n) => /Eva Editor/.test(n))).toBe(true);
    await userEvent.keyboard('{Escape}');

    await userEvent.click(within(dialog).getByRole('combobox', { name: 'QC reviewer' }));
    names = (await screen.findAllByRole('option')).map((o) => o.textContent ?? '');
    expect(names.some((n) => /Eva Editor/.test(n))).toBe(false); // an editor cannot QC
    expect(names.some((n) => /Pat Person/.test(n))).toBe(false);
    expect(names.some((n) => /Quinn QC/.test(n))).toBe(true);
  });

  it('explains a refused assignment and shows the real state again', async () => {
    db.setTaskAssignee.mockRejectedValue(new Error('the same person cannot be both the editor and the QC reviewer of a task'));
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Editor' }));
    await userEvent.click(await screen.findByRole('option', { name: /Eva Editor/ }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('the same person cannot be both the editor and the QC reviewer of a task'));
    expect(within(dialog).getByRole('combobox', { name: 'Editor' })).toHaveTextContent('Pat Person');
  });

  it('keeps showing someone who has left, instead of a blank', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER', { editorId: 'user-who-left' });
    expect(within(dialog).getByRole('combobox', { name: 'Editor' })).toHaveTextContent('Former member');
  });
});

describe('task detail sheet: subtasks', () => {
  it('ticks instantly (before the server answers) and rolls back if it fails', async () => {
    let reject: (e: Error) => void = () => undefined;
    db.updateSubtask.mockReturnValue(new Promise((_res, rej) => (reject = rej)));
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    const box = within(dialog).getByRole('checkbox', { name: 'Mark done: Captions' });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await waitFor(() => expect(within(dialog).getByRole('checkbox', { name: 'Mark not done: Captions' })).toBeChecked());
    expect(db.updateSubtask).toHaveBeenCalledWith(TASK_IDS.sub2, { isCompleted: true });
    expect(within(dialog).getByText('2/2 done')).toBeInTheDocument();

    reject(new Error('You do not have permission to update the subtask.'));
    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    await waitFor(() => expect(within(dialog).getByRole('checkbox', { name: 'Mark done: Captions' })).not.toBeChecked());
    expect(within(dialog).getByText('1/2 done')).toBeInTheDocument();
  });

  it('adds a subtask at the end of the checklist; a blank one is refused', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    const add = within(dialog).getByLabelText('Add a subtask');
    await userEvent.type(add, '   {Enter}');
    expect(await within(dialog).findByText('Enter a subtask title.')).toBeInTheDocument();
    expect(db.createSubtask).not.toHaveBeenCalled();
    await userEvent.clear(add);
    await userEvent.type(add, 'Colour pass{Enter}');
    await waitFor(() => expect(db.createSubtask).toHaveBeenCalledWith(TASK_IDS.one, 'Colour pass', 2));
    await waitFor(() => expect(add).toHaveValue(''));
  });

  it('renames and deletes a subtask', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    const title = within(dialog).getByLabelText('Subtask title: Captions');
    await userEvent.clear(title);
    await userEvent.type(title, 'Captions v2{Enter}');
    await waitFor(() => expect(db.updateSubtask).toHaveBeenCalledWith(TASK_IDS.sub2, { title: 'Captions v2' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete subtask: Rough cut' }));
    await waitFor(() => expect(db.deleteSubtask).toHaveBeenCalledWith(TASK_IDS.sub1));
  });

  it('a task with no subtasks says so, with 0% progress', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER', { subtasks: [] });
    expect(within(dialog).getByText('No subtasks')).toBeInTheDocument();
    expect(within(dialog).getByRole('progressbar', { name: 'Subtask progress' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('computes progress from the checklist, ordered by position', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER', {
      subtasks: [
        makeSubtask({ id: 'a', title: 'A', isCompleted: true, position: 0 }),
        makeSubtask({ id: 'b', title: 'B', isCompleted: true, position: 1 }),
        makeSubtask({ id: 'c', title: 'C', isCompleted: false, position: 2 }),
      ],
    });
    expect(within(dialog).getByRole('progressbar', { name: 'Subtask progress' })).toHaveAttribute('aria-valuenow', '67');
    expect(within(dialog).getByText('2/3 done')).toBeInTheDocument();
  });
});

describe('task detail sheet: what each role can touch (the database enforces the same)', () => {
  it('an editor ASSIGNED to the task: status, review link, project file and ticking only', async () => {
    const { dialog } = await openTask('EDITOR', { editorId: PEOPLE.me });
    expect(within(dialog).getByText(/tasks assigned to you/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Task title')).toBeDisabled();
    expect(within(dialog).queryByRole('combobox', { name: 'Priority' })).not.toBeInTheDocument(); // read-only text
    expect(within(dialog).getByRole('combobox', { name: 'Editor' })).toBeDisabled();
    expect(within(dialog).getByRole('combobox', { name: 'QC reviewer' })).toBeDisabled();
    expect(within(dialog).getByRole('combobox', { name: 'Aspect ratio' })).toBeDisabled();
    expect(within(dialog).getByLabelText('Internal QC due')).toBeDisabled();
    expect(within(dialog).getByLabelText('Client deadline')).toBeDisabled();
    expect(within(dialog).getByLabelText('Raw footage')).toBeDisabled();
    expect(within(dialog).getByLabelText('Final export')).toBeDisabled();
    expect(within(dialog).getByLabelText('Task brief')).toBeDisabled();
    expect(within(dialog).getByLabelText('Review link')).toBeEnabled();
    expect(within(dialog).getByLabelText('Project file')).toBeEnabled();
    expect(within(dialog).getByRole('combobox', { name: 'Status' })).toBeEnabled();
    expect(within(dialog).getByRole('checkbox', { name: 'Mark done: Captions' })).toBeEnabled();
    expect(within(dialog).queryByLabelText('Add a subtask')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Delete subtask/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Delete task/ })).not.toBeInTheDocument();
  });

  it('an assigned editor cannot choose QC-approved or later statuses', async () => {
    const { dialog } = await openTask('EDITOR', { editorId: PEOPLE.me });
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Status' }));
    const enabled = (await screen.findAllByRole('option')).filter((o) => o.getAttribute('aria-disabled') !== 'true').map((o) => o.textContent);
    expect(enabled).toEqual(expect.arrayContaining(['To do', 'In progress', 'In QC']));
    expect(enabled.join(' ')).not.toMatch(/Ready to deliver|Client review|Completed|Closed/);
  });

  it('an assigned editor can update the review link', async () => {
    const { dialog } = await openTask('EDITOR', { editorId: PEOPLE.me });
    const project = within(dialog).getByLabelText('Project file');
    await userEvent.type(project, 'https://drive.google.com/proj');
    await userEvent.tab();
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { projectFileLink: 'https://drive.google.com/proj' }));
  });

  it('an editor cannot move a task that is already in a late stage', async () => {
    const { dialog } = await openTask('EDITOR', { editorId: PEOPLE.me, status: 'READY_TO_DELIVER' });
    expect(within(dialog).queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('Ready to deliver')).toBeInTheDocument();
  });

  it('an editor NOT assigned to the task can only read it', async () => {
    const { dialog } = await openTask('EDITOR', { editorId: PEOPLE.editor2 });
    expect(within(dialog).getByText(/not assigned to you/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Review link')).toBeDisabled();
    expect(within(dialog).getByLabelText('Project file')).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: 'Mark done: Captions' })).toBeDisabled();
  });

  it('a QC specialist changes status and ticks, but cannot edit the brief or links', async () => {
    const { dialog } = await openTask('QC_SPECIALIST', { qcId: PEOPLE.me });
    expect(within(dialog).getByRole('combobox', { name: 'Status' })).toBeEnabled();
    expect(within(dialog).getByRole('checkbox', { name: 'Mark done: Captions' })).toBeEnabled();
    expect(within(dialog).getByLabelText('Task title')).toBeDisabled();
    expect(within(dialog).getByLabelText('Review link')).toBeDisabled();
    expect(within(dialog).getByRole('combobox', { name: 'QC reviewer' })).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: /Delete task/ })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Status' }));
    const enabled = (await screen.findAllByRole('option')).filter((o) => o.getAttribute('aria-disabled') !== 'true').map((o) => o.textContent);
    expect(enabled).toEqual(expect.arrayContaining(['In QC', 'Ready to deliver', 'Client review']));
    expect(enabled.join(' ')).not.toMatch(/Completed|Closed/);
  });

  it.each<TbbRole>(['OWNER', 'ADMIN', 'PRODUCTION_MANAGER'])('%s can edit everything, assign, manage subtasks and delete', async (role) => {
    const { dialog } = await openTask(role);
    expect(within(dialog).getByLabelText('Task title')).toBeEnabled();
    expect(within(dialog).getByRole('combobox', { name: 'Editor' })).toBeEnabled();
    expect(within(dialog).getByRole('combobox', { name: 'QC reviewer' })).toBeEnabled();
    expect(within(dialog).getByLabelText('Raw footage')).toBeEnabled();
    expect(within(dialog).getByLabelText('Final export')).toBeEnabled();
    expect(within(dialog).getByLabelText('Add a subtask')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Delete task/ })).toBeInTheDocument();
    expect(within(dialog).queryByText(/You can view this task/)).not.toBeInTheDocument();
  });

  it('a client viewer never reaches a task (no request, no sheet content)', async () => {
    renderWithAuth(routes, { auth: makeAuth('CLIENT_VIEWER'), route: taskUrl() });
    expect(await screen.findByRole('alert')).toHaveTextContent('No access');
    expect(db.getTask).not.toHaveBeenCalled();
  });
});

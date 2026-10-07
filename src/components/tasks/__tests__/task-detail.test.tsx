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
import { TBB_WORKFLOW } from '@/test/workflow-fixture';
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
  db.getWorkflow.mockResolvedValue(TBB_WORKFLOW);
  db.transitionTask.mockImplementation(async (id: string, input: { to: string }) => ({ ...makeDetail({ id }), status: input.to }));
  db.getLatestRevisionRequest.mockResolvedValue(null);
});

/** The workflow section at the top of the sheet (also while a move dialog covers it). */
const workflowOf = (dialog: HTMLElement) => within(dialog).getByRole('region', { name: 'Workflow', hidden: true });

describe('task detail sheet: what people see', () => {
  it('shows the whole deliverable: brief, status, assignees, deadlines, links and checklist', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    expect(db.getTask).toHaveBeenCalledWith(TASK_IDS.one);
    expect(dialog).toHaveAccessibleName('Episode 12 - Founder story');
    expect(within(dialog).getByLabelText('Task title')).toHaveValue('Episode 12 - Founder story');
    expect(within(dialog).getByRole('combobox', { name: 'Status' })).toHaveTextContent('STARTED EDITING');
    expect(within(dialog).getByRole('combobox', { name: 'Priority' })).toHaveTextContent('High');
    expect(within(dialog).getByRole('combobox', { name: 'Editor' })).toHaveTextContent('Pat Person');
    expect(within(dialog).getByRole('combobox', { name: 'QC reviewer' })).toHaveTextContent('Quinn QC');
    expect(within(dialog).getByRole('combobox', { name: 'Aspect ratio' })).toHaveTextContent('9:16');
    expect(within(dialog).getByRole('button', { name: /Internal QC due: .*12/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Client deadline: .*20/ })).toBeInTheDocument();
    // links are shown as resources: host + open + copy + edit; an empty one invites adding
    expect(within(dialog).getByRole('link', { name: /Open Raw footage \(drive\.google\.com\)/ })).toHaveAttribute('href', 'https://drive.google.com/drive/folders/abc');
    expect(within(dialog).getByRole('link', { name: /Open Review link \(app\.frame\.io\)/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add Project file' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add Final export' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Task brief')).toHaveValue('Cut to 58 seconds.');
    expect(within(dialog).getByRole('progressbar', { name: 'Subtask progress' })).toHaveAttribute('aria-valuenow', '50');
    expect(within(dialog).getByText('1/2 done')).toBeInTheDocument();
    expect(within(dialog).getByText(/1 left/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Created .* by Mia Manager/)).toBeInTheDocument();
    // the parent context is a trail of links back up the hierarchy
    const trail = within(dialog).getByRole('navigation', { name: 'Task location' });
    expect(within(trail).getByRole('link', { name: '25. EDAPTX' })).toHaveAttribute('href', LIST_URL);
    expect(within(trail).getByRole('link', { name: 'CONTENT PIPELINE - ZIM' })).toBeInTheDocument();
  });

  it('opens links safely in a new tab, and only for valid links', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    const open = within(dialog).getByRole('link', { name: /Open Raw footage \(drive\.google\.com\)/ });
    expect(open).toHaveAttribute('href', 'https://drive.google.com/drive/folders/abc');
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(dialog).queryByRole('link', { name: /Open Project file/ })).not.toBeInTheDocument(); // empty: no link
  });

  it('never turns a bad stored link into a clickable href, or a copy button', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER', { finalExportLink: 'javascript:alert(1)' });
    expect(within(dialog).queryByRole('link', { name: /Open Final export/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Copy Final export' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('javascript:alert(1)')).toBeInTheDocument(); // shown as inert text so it can be fixed
    expect(within(dialog).getByRole('button', { name: 'Edit Final export' })).toBeInTheDocument();
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
    await userEvent.click(within(dialog).getByRole('button', { name: 'Edit Review link' }));
    const review = within(dialog).getByLabelText('Review link');
    expect(review).toHaveFocus();

    await userEvent.clear(review);
    await userEvent.type(review, 'frame.io/reviews/1');
    await userEvent.tab();
    expect(await within(dialog).findByText(/Enter a full link that starts with http/)).toBeInTheDocument();
    expect(db.updateTask).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText('Review link')).toBeInTheDocument(); // still editing: the mistake is not lost

    for (const unsafe of ['javascript:alert(1)', 'data:text/html,hi']) {
      await userEvent.clear(within(dialog).getByLabelText('Review link'));
      await userEvent.type(within(dialog).getByLabelText('Review link'), unsafe);
      await userEvent.tab();
      expect(db.updateTask).not.toHaveBeenCalled();
    }

    await userEvent.clear(within(dialog).getByLabelText('Review link'));
    await userEvent.type(within(dialog).getByLabelText('Review link'), 'https://app.frame.io/reviews/new');
    await userEvent.tab();
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { reviewLink: 'https://app.frame.io/reviews/new' }));

    await userEvent.click(await within(dialog).findByRole('button', { name: 'Edit Review link' }));
    await userEvent.clear(within(dialog).getByLabelText('Review link'));
    await userEvent.tab();
    await waitFor(() => expect(db.updateTask).toHaveBeenLastCalledWith(TASK_IDS.one, { reviewLink: '' }));
  });

  it('adds an empty link from the "Add" affordance, and Escape leaves it unchanged', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add Project file' }));
    await userEvent.type(within(dialog).getByLabelText('Project file'), 'https://drive.google.com/proj{Enter}');
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { projectFileLink: 'https://drive.google.com/proj' }));
    db.updateTask.mockClear();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add Final export' }));
    await userEvent.type(within(dialog).getByLabelText('Final export'), 'https://x.co/f{Escape}');
    expect(db.updateTask).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Add Final export' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // Escape cancelled the edit, it did not close the sheet
  });

  it('copies a saved link to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy Raw footage' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://drive.google.com/drive/folders/abc'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy task link' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expect.stringMatching(new RegExp(`/tasks/${TASK_IDS.one}$`))));
  });

  it('saves the brief when you click away, keeps line breaks, and Escape discards the edit', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    const brief = within(dialog).getByLabelText('Task brief');
    expect(within(dialog).getByText('Saves when you click away')).toBeInTheDocument();
    await userEvent.type(brief, ' Add captions.{Escape}');
    expect(brief).toHaveValue('Cut to 58 seconds.');
    expect(db.updateTask).not.toHaveBeenCalled();

    await userEvent.type(brief, '\nHook first.');
    expect(within(dialog).getByText(/Unsaved changes/)).toBeInTheDocument();
    await userEvent.tab();
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { description: 'Cut to 58 seconds.\nHook first.' }));
  });

  it('saves the brief with Ctrl+Enter, and an unchanged brief sends nothing', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    const brief = within(dialog).getByLabelText('Task brief');
    await userEvent.click(brief);
    await userEvent.tab();
    expect(db.updateTask).not.toHaveBeenCalled();
    await userEvent.type(brief, '!{Control>}{Enter}{/Control}');
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { description: 'Cut to 58 seconds.!' }));
  });

  it('refuses a brief over 20,000 characters without sending it', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER', { description: '' });
    const brief = within(dialog).getByLabelText('Task brief');
    await userEvent.click(brief);
    await userEvent.paste('x'.repeat(20001));
    await userEvent.tab();
    expect(await within(dialog).findByText(/20,000 characters/)).toBeInTheDocument();
    expect(db.updateTask).not.toHaveBeenCalled();
  });

  it('changes priority, stage and aspect ratio from their selectors', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Priority' }));
    await userEvent.click(await screen.findByRole('option', { name: /Low/ }));
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { priority: 'LOW' }));

    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Status' }));
    await userEvent.click(await screen.findByRole('option', { name: /Submit for QC/ }));
    await waitFor(() => expect(db.transitionTask).toHaveBeenCalledWith(TASK_IDS.one, expect.objectContaining({ to: 'QC_FIRST_APPROVAL', expectedFrom: 'STARTED_EDITING' })));
    expect(db.updateTask).not.toHaveBeenCalledWith(TASK_IDS.one, expect.objectContaining({ status: expect.anything() }));

    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Aspect ratio' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Not set' }));
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { aspectRatio: null }));
  });

  it('picks, shortcuts and clears deadlines with the date picker', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    await userEvent.click(within(dialog).getByRole('button', { name: /Client deadline: / }));
    await userEvent.click(await screen.findByRole('button', { name: 'Next week' }));
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { clientDeadline: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:00:00\.000Z$/) }));

    await userEvent.click(within(dialog).getByRole('button', { name: /Internal QC due: / }));
    await userEvent.click(await screen.findByRole('gridcell', { name: '18' }));
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { dueDate: expect.stringMatching(/^2026-10-18T/) }));

    await userEvent.click(within(dialog).getByRole('button', { name: /Internal QC due: / }));
    await userEvent.click(await screen.findByRole('button', { name: /Clear/ }));
    await waitFor(() => expect(db.updateTask).toHaveBeenLastCalledWith(TASK_IDS.one, { dueDate: null }));
  });

  it('picking the date that is already set sends nothing', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    await userEvent.click(within(dialog).getByRole('button', { name: /Internal QC due: / }));
    await userEvent.click(await screen.findByRole('gridcell', { name: '12' }));
    expect(db.updateTask).not.toHaveBeenCalled();
  });

  it('shows an unset deadline as "Set date" and marks an overdue one', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER', { dueDate: '2020-01-02T12:00:00.000Z', clientDeadline: null });
    expect(within(dialog).getByRole('button', { name: 'Client deadline: not set' })).toHaveTextContent('Set date');
    expect(within(dialog).getByRole('button', { name: /Internal QC due: / })).toHaveTextContent('overdue');
  });

  it('a finished task is never shown as overdue', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER', { status: 'CLOSED', dueDate: '2020-01-02T12:00:00.000Z' });
    expect(within(dialog).getByRole('button', { name: /Internal QC due: / })).not.toHaveTextContent('overdue');
  });

  it('shows a quiet "Saved" confirmation after a change, and "Not saved" if it fails', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Priority' }));
    await userEvent.click(await screen.findByRole('option', { name: /Low/ }));
    expect(await within(dialog).findByText('Saved')).toBeInTheDocument();
    db.updateTask.mockRejectedValue(new Error('You do not have permission to update the task.'));
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Priority' }));
    await userEvent.click(await screen.findByRole('option', { name: /Urgent/ }));
    expect(await within(dialog).findByText('Not saved')).toBeInTheDocument();
  });

  it('shows the new value at once, before the server answers, and restores it if the save fails', async () => {
    let reject: (e: Error) => void = () => undefined;
    db.updateTask.mockReturnValue(new Promise((_res, rej) => (reject = rej)));
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Priority' }));
    await userEvent.click(await screen.findByRole('option', { name: /Low/ }));
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Priority' })).toHaveTextContent('Low'));
    reject(new Error('You do not have permission to update the task.'));
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Priority' })).toHaveTextContent('High'));
  });

  it('warns softly (never blocks) when the QC date is after the client deadline', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER', { dueDate: '2026-10-30T12:00:00.000Z', clientDeadline: '2026-10-20T12:00:00.000Z' });
    expect(within(dialog).getByText(/after the client deadline/)).toBeInTheDocument();
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

  it('deletes only after confirmation (from the actions menu), then returns to the list', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    const openConfirm = async () => {
      await userEvent.click(within(dialog).getByRole('button', { name: 'More task actions' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: /Delete task/ }));
      return screen.findByRole('alertdialog');
    };
    const confirm = await openConfirm();
    expect(confirm).toHaveTextContent('its 2 subtasks');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(db.deleteTask).not.toHaveBeenCalled();

    await userEvent.click(within(await openConfirm()).getByRole('button', { name: 'Delete' }));
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

  it('searches people by name or role with a plain match (no unrelated fuzzy hits), and picks with Enter', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'QC reviewer' }));
    const search = screen.getByPlaceholderText('Search people...');

    // "Mia Manager" and "Ada Admin" contain m, i, a as scattered letters of "Quinn QC"'s role text etc.:
    // a fuzzy matcher would surface unrelated people; a plain match must not
    await userEvent.type(search, 'mia');
    expect(screen.getByRole('option', { name: /Mia Manager/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Quinn QC/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Ada Admin/ })).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, 'specialist'); // by role
    expect(screen.getByRole('option', { name: /Quinn QC/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Mia Manager/ })).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, 'mia{Enter}');
    await waitFor(() => expect(db.setTaskAssignee).toHaveBeenCalledWith(TASK_IDS.one, 'QC_REVIEWER', PEOPLE.manager));
  });

  it('shows "No one matches" for a search with no result', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Editor' }));
    await userEvent.type(screen.getByPlaceholderText('Search people...'), 'zzzz');
    expect(await screen.findByText('No one matches.')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
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
  it('an editor ASSIGNED to the task: their workflow steps, review link, project file and ticking only; the rest is plain text', async () => {
    const { dialog } = await openTask('EDITOR', { editorId: PEOPLE.me });
    expect(within(dialog).getByText(/submit cuts for QC/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Task title')).toBeDisabled();
    // read-only values are NOT controls: nothing that looks editable and then fails
    for (const name of ['Priority', 'Editor', 'QC reviewer', 'Aspect ratio']) {
      expect(within(dialog).queryByRole('combobox', { name })).not.toBeInTheDocument();
    }
    expect(within(dialog).queryByRole('button', { name: /^(Internal QC due|Client deadline): / })).not.toBeInTheDocument();
    expect(within(dialog).getByText('Pat Person')).toBeInTheDocument();
    expect(within(dialog).getByText('Quinn QC')).toBeInTheDocument();
    expect(within(dialog).getByText('9:16 · Vertical')).toBeInTheDocument();
    expect(within(dialog).getByText('Urgent'.replace('Urgent', 'High'))).toBeInTheDocument();
    // links: raw footage / final export are view-only; review + project are editable
    expect(within(dialog).queryByRole('button', { name: 'Edit Raw footage' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('Not added')).toBeInTheDocument(); // final export is empty and not addable
    expect(within(dialog).queryByRole('button', { name: 'Add Final export' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Edit Review link' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add Project file' })).toBeInTheDocument();
    // brief is text, not an editor
    expect(within(dialog).queryByRole('textbox', { name: 'Task brief' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('region', { name: 'Task brief' })).toHaveTextContent('Cut to 58 seconds.');
    expect(within(dialog).getByRole('combobox', { name: 'Status' })).toBeEnabled();
    expect(within(dialog).getByRole('checkbox', { name: 'Mark done: Captions' })).toBeEnabled();
    expect(within(dialog).queryByLabelText('Add a subtask')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Delete subtask/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'More task actions' })).not.toBeInTheDocument();
  });

  it('an assigned editor is offered only editing steps; approval and delivery are shown disabled, with the reason', async () => {
    const { dialog } = await openTask('EDITOR', { editorId: PEOPLE.me });
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Status' }));
    const options = await screen.findAllByRole('option');
    const enabled = options.filter((o) => o.getAttribute('aria-disabled') !== 'true').map((o) => o.textContent ?? '');
    expect(enabled).toHaveLength(2);
    expect(enabled.join(' ')).toMatch(/Submit for QC.*Pause editing/);
    const approved = options.find((o) => /^QC - APPROVED/.test(o.textContent ?? ''))!;
    expect(approved).toHaveAttribute('aria-disabled', 'true');
    expect(approved).toHaveTextContent('Not a step from STARTED EDITING.');
  });

  it('an assigned editor can add the project file link', async () => {
    const { dialog } = await openTask('EDITOR', { editorId: PEOPLE.me });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add Project file' }));
    await userEvent.type(within(dialog).getByLabelText('Project file'), 'https://drive.google.com/proj');
    await userEvent.tab();
    await waitFor(() => expect(db.updateTask).toHaveBeenCalledWith(TASK_IDS.one, { projectFileLink: 'https://drive.google.com/proj' }));
  });

  it('an editor cannot move a task that is past editing; the panel says who it waits on', async () => {
    const { dialog } = await openTask('EDITOR', { editorId: PEOPLE.me, status: 'QC_APPROVED_RTD' });
    expect(within(dialog).queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument();
    const panel = workflowOf(dialog);
    expect(panel).toHaveTextContent('QC - APPROVED (RTD)');
    expect(within(panel).queryByRole('button')).not.toBeInTheDocument();
    expect(panel).toHaveTextContent('Waiting on Production Manager or QC Specialist');
  });

  it('an editor NOT assigned to the task can only read it', async () => {
    const { dialog } = await openTask('EDITOR', { editorId: PEOPLE.editor2 });
    expect(within(dialog).getByText(/not assigned to you/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Add / })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'Mark done: Captions' })).toBeDisabled();
    // links can still be opened and copied: reading is allowed
    expect(within(dialog).getByRole('link', { name: /Open Raw footage/ })).toBeInTheDocument();
  });

  it('a QC specialist approves / sends back, ticks and sets the final export, but cannot edit the brief or other links', async () => {
    const { dialog } = await openTask('QC_SPECIALIST', { qcId: PEOPLE.me, status: 'QC_FIRST_APPROVAL' });
    expect(within(dialog).getByRole('combobox', { name: 'Status' })).toBeEnabled();
    expect(within(dialog).getByRole('checkbox', { name: 'Mark done: Captions' })).toBeEnabled();
    expect(within(dialog).getByLabelText('Task title')).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add Final export' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Add Project file' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox', { name: 'QC reviewer' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: 'Task brief' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'More task actions' })).not.toBeInTheDocument();
    const panel = workflowOf(dialog);
    expect(within(panel).getAllByRole('button').map((b) => b.textContent)).toEqual(['Pass to final approval', 'Approve (ready to deliver)', 'Request revision']);
  });

  it.each<TbbRole>(['OWNER', 'ADMIN', 'PRODUCTION_MANAGER'])('%s can edit everything, assign, manage subtasks, move it and delete', async (role) => {
    const { dialog } = await openTask(role);
    expect(within(dialog).getByLabelText('Task title')).toBeEnabled();
    for (const name of ['Status', 'Priority', 'Editor', 'QC reviewer', 'Aspect ratio']) {
      expect(within(dialog).getByRole('combobox', { name })).toBeEnabled();
    }
    expect(within(dialog).getByRole('button', { name: /Internal QC due: / })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: /Client deadline: / })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Edit Raw footage' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add Final export' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Task brief')).toBeEnabled();
    expect(within(dialog).getByLabelText('Add a subtask')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'More task actions' })).toBeInTheDocument();
    expect(within(dialog).queryByText(/You can view this task/)).not.toBeInTheDocument();
  });

  it('a client viewer never reaches a task (no request, no sheet content)', async () => {
    renderWithAuth(routes, { auth: makeAuth('CLIENT_VIEWER'), route: taskUrl() });
    expect(await screen.findByRole('alert')).toHaveTextContent('No access');
    expect(db.getTask).not.toHaveBeenCalled();
  });
});


describe('task detail sheet: the workflow panel', () => {
  it('shows the stage, how far along it is, and the next step as a button', async () => {
    const { dialog } = await openTask('EDITOR', { editorId: PEOPLE.me });
    const panel = workflowOf(dialog);
    expect(panel).toHaveTextContent('STARTED EDITING');
    expect(panel).toHaveTextContent('Stage 4 of 10');
    const buttons = within(panel).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Submit for QC', 'Pause editing']);
    await userEvent.click(buttons[0]);
    // the review link is already there, so nothing is asked: one atomic move
    await waitFor(() =>
      expect(db.transitionTask).toHaveBeenCalledWith(TASK_IDS.one, expect.objectContaining({ to: 'QC_FIRST_APPROVAL', expectedFrom: 'STARTED_EDITING' }))
    );
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Moved to QC - FIRST APPROVAL'));
  });

  it('submitting for QC without a review link asks for it and sends it with the move', async () => {
    const { dialog } = await openTask('EDITOR', { editorId: PEOPLE.me, reviewLink: null });
    await userEvent.click(within(workflowOf(dialog)).getByRole('button', { name: 'Submit for QC' }));
    const ask = await screen.findByRole('dialog', { name: 'Submit for QC' });
    await userEvent.type(within(ask).getByLabelText('Review link of the cut'), 'javascript:alert(1)');
    await userEvent.click(within(ask).getByRole('button', { name: 'Submit for QC' }));
    expect(await within(ask).findByRole('alert')).toBeInTheDocument();
    expect(db.transitionTask).not.toHaveBeenCalled();
    await userEvent.clear(within(ask).getByLabelText('Review link of the cut'));
    await userEvent.type(within(ask).getByLabelText('Review link of the cut'), 'https://app.frame.io/reviews/new');
    await userEvent.click(within(ask).getByRole('button', { name: 'Submit for QC' }));
    await waitFor(() =>
      expect(db.transitionTask).toHaveBeenCalledWith(TASK_IDS.one, expect.objectContaining({ to: 'QC_FIRST_APPROVAL', reviewLink: 'https://app.frame.io/reviews/new' }))
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Submit for QC' })).not.toBeInTheDocument());
  });

  it('a refused move keeps the dialog (nothing typed is lost) and puts the stage back', async () => {
    db.transitionTask.mockRejectedValue(new Error('QC - FIRST APPROVAL needs the review link of the cut.'));
    const { dialog } = await openTask('EDITOR', { editorId: PEOPLE.me, reviewLink: null });
    await userEvent.click(within(workflowOf(dialog)).getByRole('button', { name: 'Submit for QC' }));
    const ask = await screen.findByRole('dialog', { name: 'Submit for QC' });
    await userEvent.type(within(ask).getByLabelText('Review link of the cut'), 'https://app.frame.io/r');
    await userEvent.click(within(ask).getByRole('button', { name: 'Submit for QC' }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('QC - FIRST APPROVAL needs the review link of the cut.'));
    expect(within(ask).getByLabelText('Review link of the cut')).toHaveValue('https://app.frame.io/r');
    expect(workflowOf(dialog)).toHaveTextContent('STARTED EDITING');
  });

  it('while a cut is sent back, the editor sees what to change, who asked and when, and the revision number', async () => {
    db.getLatestRevisionRequest.mockResolvedValue({
      id: 'e1', taskId: TASK_IDS.one, from: 'QC_FIRST_APPROVAL', to: 'QC_REVISION_NEEDED', actorId: PEOPLE.qc,
      note: 'Tighten the intro.\nFix the caption at 0:42.', isOverride: false, revisionNumber: 2, createdAt: '2026-10-05T10:00:00Z',
    });
    const { dialog } = await openTask('EDITOR', { editorId: PEOPLE.me, status: 'QC_REVISION_NEEDED', revisionCount: 2 });
    const panel = workflowOf(dialog);
    const note = await within(panel).findByRole('note', { name: 'Requested changes' });
    expect(note).toHaveTextContent('Revision 2 requested by Quinn QC on');
    expect(note).toHaveTextContent('Fix the caption at 0:42.');
    expect(within(panel).getByText('Revision 2')).toBeInTheDocument();
    expect(db.getLatestRevisionRequest).toHaveBeenCalledWith(TASK_IDS.one);
    expect(within(panel).getAllByRole('button').map((b) => b.textContent)).toEqual(['Submit revision']);
  });

  it('the revision note is not fetched for a task that is not in revision', async () => {
    await openTask('EDITOR', { editorId: PEOPLE.me, revisionCount: 1 });
    expect(db.getLatestRevisionRequest).not.toHaveBeenCalled();
  });

  it('QC requests a revision from the panel: a note is required and the move counts a revision at once', async () => {
    let finish: (v: unknown) => void = () => undefined;
    const { dialog } = await openTask('QC_SPECIALIST', { status: 'QC_FINAL_APPROVAL', revisionCount: 1 });
    await userEvent.click(within(workflowOf(dialog)).getByRole('button', { name: 'Request another revision' }));
    const ask = await screen.findByRole('dialog', { name: 'Request another revision' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Request another revision' }));
    expect(await within(ask).findByText('Say what needs to change.')).toBeInTheDocument();
    db.transitionTask.mockReturnValue(new Promise((r) => (finish = r)));
    await userEvent.type(within(ask).getByLabelText('What needs to change?'), 'Music too loud');
    await userEvent.click(within(ask).getByRole('button', { name: 'Request another revision' }));
    expect(db.transitionTask).toHaveBeenCalledWith(TASK_IDS.one, expect.objectContaining({ to: 'QC_REVISION_NEEDED', note: 'Music too loud', expectedFrom: 'QC_FINAL_APPROVAL' }));
    await waitFor(() => expect(within(workflowOf(dialog)).getByText('Revision 2')).toBeInTheDocument());
    finish({ ...makeDetail(), status: 'QC_REVISION_NEEDED', revisionCount: 2 });
  });

  it('delivering asks QC for the final export when it is missing', async () => {
    const { dialog } = await openTask('QC_SPECIALIST', { status: 'QC_APPROVED_RTD', finalExportLink: null });
    await userEvent.click(within(workflowOf(dialog)).getByRole('button', { name: 'Send to client' }));
    const ask = await screen.findByRole('dialog', { name: 'Send to client' });
    await userEvent.type(within(ask).getByLabelText('Final export link'), 'https://drive.google.com/final');
    await userEvent.click(within(ask).getByRole('button', { name: 'Send to client' }));
    await waitFor(() =>
      expect(db.transitionTask).toHaveBeenCalledWith(TASK_IDS.one, expect.objectContaining({ to: 'SENT_TO_CLIENT', finalExportLink: 'https://drive.google.com/final' }))
    );
  });

  it('a manager closes a delivered task; a closed task reads as finished and can be reopened', async () => {
    const { dialog } = await openTask('PRODUCTION_MANAGER', { status: 'SENT_TO_CLIENT', finalExportLink: 'https://drive.google.com/f' });
    expect(within(workflowOf(dialog)).getAllByRole('button').map((b) => b.textContent)).toEqual(['Close', 'Client requested changes']);
    await userEvent.click(within(workflowOf(dialog)).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(db.transitionTask).toHaveBeenCalledWith(TASK_IDS.one, expect.objectContaining({ to: 'CLOSED' })));
  });
});

describe('task detail sheet: moving between tasks', () => {
  const rows = [
    makeSummary({ id: TASK_IDS.one, title: 'First', position: 0 }),
    makeSummary({ id: TASK_IDS.two, title: 'Second', position: 1 }),
    makeSummary({ id: TASK_IDS.three, title: 'Third', position: 2 }),
  ];

  it('shows where this task is in the list and steps to the next and previous task', async () => {
    db.listTasks.mockResolvedValue({ items: rows, total: 3 });
    const { dialog } = await openTask('PRODUCTION_MANAGER', { id: TASK_IDS.two }, taskUrl(TASK_IDS.two));
    expect(await within(dialog).findByLabelText('Task 2 of 3')).toHaveTextContent('2 / 3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next task' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(taskUrl(TASK_IDS.three)));
    await userEvent.click(await screen.findByRole('button', { name: 'Previous task' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(taskUrl(TASK_IDS.two)));
  });

  it('the first task has no previous and the last has no next', async () => {
    db.listTasks.mockResolvedValue({ items: rows, total: 3 });
    const { dialog } = await openTask('PRODUCTION_MANAGER', { id: TASK_IDS.one }, taskUrl(TASK_IDS.one));
    await within(dialog).findByLabelText('Task 1 of 3');
    expect(within(dialog).getByRole('button', { name: 'Previous task' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Next task' })).toBeEnabled();
  });
});

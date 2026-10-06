import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import SpacesTree from '../SpacesTree';
import { makeAuth, renderWithAuth } from '@/test/auth-utils';
import type { createDatabaseMock } from '@/test/database-mock';
import * as dbModule from '@/database';
import { IDS, makeFolder, makeList, makeSpace, makeTree } from '@/test/hierarchy-fixtures';
import type { TbbRole } from '@/types/database';

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

const Where: React.FC = () => <span data-testid="where">{useLocation().pathname}</span>;

const renderTree = (role: TbbRole = 'OWNER', route = '/home') =>
  renderWithAuth(
    <TooltipProvider>
      <Routes>
        <Route path="*" element={<><SpacesTree collapsed={false} /><Where /></>} />
      </Routes>
    </TooltipProvider>,
    { auth: makeAuth(role), route }
  );

const openMenu = async (name: string, item: string) => {
  await userEvent.click(await screen.findByRole('button', { name: `Actions for ${name}` }));
  await userEvent.click(await screen.findByRole('menuitem', { name: item }));
};

beforeEach(() => {
  vi.clearAllMocks();
  db.getWorkspaceHierarchy.mockResolvedValue(makeTree());
});

describe('space dialog', () => {
  it('validates before saving', async () => {
    renderTree();
    await userEvent.click(await screen.findByRole('button', { name: 'New space' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create space' }));
    expect(await within(dialog).findByText('Enter a space name.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText('Name'));
    await userEvent.paste('x'.repeat(256));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create space' }));
    expect(await within(dialog).findByText(/255 characters or fewer/)).toBeInTheDocument();
    expect(db.createSpace).not.toHaveBeenCalled();
  });

  it('creates a space at the end of the list with the chosen icon and color, then opens it', async () => {
    db.createSpace.mockResolvedValue(makeSpace({ id: IDS.missing, name: 'Social' }));
    renderTree();
    await userEvent.click(await screen.findByRole('button', { name: 'New space' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), '  Social  ');
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Short form');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'rocket' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: '#22C55E' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create space' }));

    await waitFor(() => expect(db.createSpace).toHaveBeenCalledTimes(1));
    expect(db.createSpace).toHaveBeenCalledWith({
      name: '  Social  ',
      description: 'Short form',
      icon: 'rocket',
      color: '#22C55E',
      workspaceId: 'ws-1',
      position: 2, // after the existing spaces at 0 and 1
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('where')).toHaveTextContent(`/spaces/${IDS.missing}`);
    await waitFor(() => expect(db.getWorkspaceHierarchy).toHaveBeenCalledTimes(2)); // tree refreshed
  });

  it('disables the form while saving and shows the failure without closing', async () => {
    let reject: (e: Error) => void = () => undefined;
    db.createSpace.mockReturnValue(new Promise((_, r) => (reject = r)));
    renderTree();
    await userEvent.click(await screen.findByRole('button', { name: 'New space' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Social');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create space' }));
    expect(within(dialog).getByRole('button', { name: 'Create space' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    reject(new Error('You do not have permission to create the space.'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('do not have permission');
    expect(within(dialog).getByRole('button', { name: 'Create space' })).toBeEnabled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('edits an existing space with its values prefilled and stays where it is', async () => {
    db.updateSpace.mockResolvedValue(makeSpace({ id: IDS.spaceB, name: 'Design Team' }));
    renderTree('OWNER', '/home');
    await screen.findByText('Design');
    await openMenu('Design', 'Edit space');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Design');
    expect(within(dialog).getByRole('radio', { name: 'palette' })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByRole('radio', { name: '#EC4899' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.clear(within(dialog).getByLabelText('Name'));
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Design Team');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(db.updateSpace).toHaveBeenCalledWith(IDS.spaceB, {
        name: 'Design Team', description: '', icon: 'palette', color: '#EC4899',
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('where')).toHaveTextContent('/home');
  });

  it('Cancel closes without saving', async () => {
    renderTree();
    await userEvent.click(await screen.findByRole('button', { name: 'New space' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(db.createSpace).not.toHaveBeenCalled();
  });
});

describe('folder dialog', () => {
  it('requires a name', async () => {
    renderTree();
    await screen.findByText('Content Pipelines');
    await openMenu('Content Pipelines', 'New folder');
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create folder' }));
    expect(await within(dialog).findByText('Enter a folder name.')).toBeInTheDocument();
    expect(db.createFolder).not.toHaveBeenCalled();
  });

  it('creates a folder in the chosen space, after its siblings, and opens it', async () => {
    db.createFolder.mockResolvedValue(makeFolder({ id: IDS.missing, name: 'CONTENT PIPELINE - NEW', spaceId: IDS.spaceA }));
    renderTree();
    await screen.findByText('Content Pipelines');
    await openMenu('Content Pipelines', 'New folder');
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'CONTENT PIPELINE - NEW');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create folder' }));
    await waitFor(() =>
      expect(db.createFolder).toHaveBeenCalledWith({
        name: 'CONTENT PIPELINE - NEW', description: '', spaceId: IDS.spaceA, position: 2,
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(`/spaces/${IDS.spaceA}/folders/${IDS.missing}`)
    );
  });

  it('renames a folder', async () => {
    db.updateFolder.mockResolvedValue(makeFolder({ id: IDS.folderZim, name: 'ZIM', spaceId: IDS.spaceA }));
    renderTree('PRODUCTION_MANAGER', `/spaces/${IDS.spaceA}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for CONTENT PIPELINE - ZIM' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit folder' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Name')).toHaveValue('CONTENT PIPELINE - ZIM');
    await userEvent.clear(within(dialog).getByLabelText('Name'));
    await userEvent.type(within(dialog).getByLabelText('Name'), 'ZIM');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(db.updateFolder).toHaveBeenCalledWith(IDS.folderZim, { name: 'ZIM', description: '' }));
  });
});

describe('list dialog', () => {
  it('creates a list inside a folder (preselected) after the folder\'s lists, and opens it', async () => {
    db.createList.mockResolvedValue(makeList({ id: IDS.missing, name: '50. THE DESIRE COMPANY', spaceId: IDS.spaceA, folderId: IDS.folderZim }));
    renderTree('PRODUCTION_MANAGER', `/spaces/${IDS.spaceA}`);
    await openMenu('CONTENT PIPELINE - ZIM', 'New list');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Folder' })).toHaveTextContent('CONTENT PIPELINE - ZIM');
    await userEvent.type(within(dialog).getByLabelText('Name'), '50. THE DESIRE COMPANY');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));
    await waitFor(() =>
      expect(db.createList).toHaveBeenCalledWith({
        name: '50. THE DESIRE COMPANY', description: '', color: '#7B68EE', folderId: IDS.folderZim,
        spaceId: IDS.spaceA, position: 2,
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(`/spaces/${IDS.spaceA}/lists/${IDS.missing}`)
    );
  });

  it('creates a list directly in a space', async () => {
    db.createList.mockResolvedValue(makeList({ id: IDS.missing, name: 'Inbox', spaceId: IDS.spaceB }));
    renderTree();
    await screen.findByText('Design');
    await openMenu('Design', 'New list');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Folder' })).toHaveTextContent('No folder');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Inbox');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));
    await waitFor(() =>
      expect(db.createList).toHaveBeenCalledWith(expect.objectContaining({ spaceId: IDS.spaceB, folderId: null, position: 0 }))
    );
  });

  it('requires a name', async () => {
    renderTree();
    await screen.findByText('Design');
    await openMenu('Design', 'New list');
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));
    expect(await within(dialog).findByText('Enter a list name.')).toBeInTheDocument();
    expect(db.createList).not.toHaveBeenCalled();
  });

  it('moving a list to another folder appends it there; a plain edit keeps its position', async () => {
    db.updateList.mockResolvedValue(makeList({ id: IDS.listEdaptx, name: '25. EDAPTX', spaceId: IDS.spaceA }));
    renderTree('PRODUCTION_MANAGER', `/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}`);
    await openMenu('25. EDAPTX', 'Edit list');
    let dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Folder' }));
    await userEvent.click(await screen.findByRole('option', { name: 'CONTENT PIPELINE - MYLA' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(db.updateList).toHaveBeenCalledTimes(1));
    expect(db.updateList).toHaveBeenLastCalledWith(
      IDS.listEdaptx,
      expect.objectContaining({ folderId: IDS.folderMyla, position: 0 }) // Myla is empty: first slot
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await openMenu('25. EDAPTX', 'Edit list');
    dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText('Name'));
    await userEvent.type(within(dialog).getByLabelText('Name'), 'EDAPTX');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(db.updateList).toHaveBeenCalledTimes(2));
    expect(db.updateList.mock.calls[1][1]).not.toHaveProperty('position');
    expect(db.updateList.mock.calls[1][1]).toMatchObject({ folderId: IDS.folderZim, name: 'EDAPTX' });
  });

  it('surfaces a database refusal inside the dialog', async () => {
    db.createList.mockRejectedValue(new Error('That folder does not belong to this space.'));
    renderTree();
    await screen.findByText('Design');
    await openMenu('Design', 'New list');
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Inbox');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('does not belong to this space');
  });
});

describe('delete confirmations', () => {
  it('deleting a space says exactly what is lost and only deletes after confirmation', async () => {
    db.deleteSpace.mockResolvedValue(undefined);
    renderTree('OWNER', `/spaces/${IDS.spaceA}`);
    await screen.findByText('Content Pipelines');
    await openMenu('Content Pipelines', 'Delete space');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete space "Content Pipelines"?');
    expect(dialog).toHaveTextContent('2 folders and 3 lists');
    expect(db.deleteSpace).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(db.deleteSpace).toHaveBeenCalledWith(IDS.spaceA));
    // the page that was being viewed no longer exists: go home
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/home'));
  });

  it('cancelling deletes nothing', async () => {
    renderTree('OWNER');
    await screen.findByText('Content Pipelines');
    await openMenu('Content Pipelines', 'Delete space');
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(db.deleteSpace).not.toHaveBeenCalled();
  });

  it('an empty space gets a plain message', async () => {
    renderTree('OWNER');
    await screen.findByText('Design');
    await openMenu('Design', 'Delete space');
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('This space is empty');
  });

  it('a folder that still has lists cannot be deleted: the dialog explains and offers no Delete', async () => {
    renderTree('ADMIN', `/spaces/${IDS.spaceA}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for CONTENT PIPELINE - ZIM' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete folder' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('is not empty');
    expect(dialog).toHaveTextContent('2 lists');
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(db.deleteFolder).not.toHaveBeenCalled();
  });

  it('an empty folder is deleted and the viewer returns to its space', async () => {
    db.deleteFolder.mockResolvedValue(undefined);
    renderTree('ADMIN', `/spaces/${IDS.spaceA}/folders/${IDS.folderMyla}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for CONTENT PIPELINE - MYLA' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete folder' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(db.deleteFolder).toHaveBeenCalledWith(IDS.folderMyla));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/spaces/${IDS.spaceA}`));
    expect(screen.getByTestId('where')).not.toHaveTextContent('folders');
  });

  it('deleting the open list returns to its folder', async () => {
    db.deleteList.mockResolvedValue(undefined);
    renderTree('ADMIN', `/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for 25. EDAPTX' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete list' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(db.deleteList).toHaveBeenCalledWith(IDS.listEdaptx));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/spaces/${IDS.spaceA}/folders/${IDS.folderZim}`));
  });

  it('deleting a list that is not open does not move the viewer', async () => {
    db.deleteList.mockResolvedValue(undefined);
    renderTree('ADMIN', '/home');
    await screen.findByText('Content Pipelines');
    await userEvent.click(screen.getByRole('button', { name: 'Expand Content Pipelines' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Raw Intake' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete list' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(db.deleteList).toHaveBeenCalledWith(IDS.listIntake));
    expect(screen.getByTestId('where')).toHaveTextContent('/home');
  });

  it('a failed delete keeps the dialog open so it can be retried or cancelled', async () => {
    db.deleteSpace.mockRejectedValue(new Error('You do not have permission to delete the space.'));
    renderTree('OWNER');
    await screen.findByText('Design');
    await openMenu('Design', 'Delete space');
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(db.deleteSpace).toHaveBeenCalled());
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })).toBeEnabled();
  });
});

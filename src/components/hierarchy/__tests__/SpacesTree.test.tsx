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
import { IDS, makeTree } from '@/test/hierarchy-fixtures';
import { SIDEBAR_EXPANDED_STORAGE_KEY } from '@/hooks/use-expanded-nodes';
import type { TbbRole } from '@/types/database';

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

const Where: React.FC = () => <span data-testid="where">{useLocation().pathname}</span>;

const renderTree = (role: TbbRole = 'OWNER', route = '/home', collapsed = false) =>
  renderWithAuth(
    <TooltipProvider>
      <Routes>
        <Route path="*" element={<><SpacesTree collapsed={collapsed} /><Where /></>} />
      </Routes>
    </TooltipProvider>,
    { auth: makeAuth(role), route }
  );

beforeEach(() => {
  vi.clearAllMocks();
  db.getWorkspaceHierarchy.mockResolvedValue(makeTree());
  db.reorderHierarchy.mockResolvedValue(undefined);
});

describe('SpacesTree: states', () => {
  it('shows a loading state while the hierarchy loads', () => {
    db.getWorkspaceHierarchy.mockReturnValue(new Promise(() => undefined));
    renderTree();
    expect(screen.getByRole('status', { name: 'Loading spaces' })).toBeInTheDocument();
  });

  it('empty workspace: an Owner is invited to create the first space', async () => {
    db.getWorkspaceHierarchy.mockResolvedValue([]);
    renderTree('OWNER');
    expect(await screen.findByText('No spaces yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create your first space' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('New space');
  });

  it('empty workspace: other roles are told who can create spaces and get no create controls', async () => {
    db.getWorkspaceHierarchy.mockResolvedValue([]);
    renderTree('EDITOR');
    expect(await screen.findByText(/An Owner or Admin can create spaces/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New space' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create your first space' })).not.toBeInTheDocument();
  });

  it('shows the error with a working retry', async () => {
    db.getWorkspaceHierarchy.mockRejectedValueOnce(new Error('Failed to load spaces: connection failure'));
    renderTree();
    expect(await screen.findByRole('alert')).toHaveTextContent('connection failure');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Content Pipelines')).toBeInTheDocument();
  });

  it('asks the database for the signed-in workspace only', async () => {
    renderTree();
    await screen.findByText('Content Pipelines');
    expect(db.getWorkspaceHierarchy).toHaveBeenCalledWith('ws-1');
    expect(db.getWorkspaceHierarchy).toHaveBeenCalledTimes(1);
  });
});

describe('SpacesTree: hierarchy and navigation', () => {
  it('renders spaces collapsed, then expands folders and lists on demand', async () => {
    renderTree();
    expect(await screen.findByText('Content Pipelines')).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.queryByText('CONTENT PIPELINE - ZIM')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Expand Content Pipelines' }));
    expect(screen.getByText('CONTENT PIPELINE - ZIM')).toBeInTheDocument();
    expect(screen.getByText('Raw Intake')).toBeInTheDocument(); // list directly in the space
    expect(screen.queryByText('25. EDAPTX')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Expand CONTENT PIPELINE - ZIM' }));
    expect(screen.getByText('25. EDAPTX')).toBeInTheDocument();
    expect(screen.getByText('2. CONOR CONTENT')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Collapse Content Pipelines' }));
    expect(screen.queryByText('CONTENT PIPELINE - ZIM')).not.toBeInTheDocument();
  });

  it('shows empty folders and empty spaces honestly', async () => {
    renderTree();
    await screen.findByText('Content Pipelines');
    await userEvent.click(screen.getByRole('button', { name: 'Expand Content Pipelines' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand CONTENT PIPELINE - MYLA' }));
    expect(screen.getByText('No lists')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Expand Design' }));
    expect(screen.getByText('Empty space')).toBeInTheDocument();
  });

  it('navigates to the exact space, folder and list URLs', async () => {
    renderTree();
    await screen.findByText('Content Pipelines');
    await userEvent.click(screen.getByRole('link', { name: 'Content Pipelines' }));
    expect(screen.getByTestId('where')).toHaveTextContent(`/spaces/${IDS.spaceA}`);

    await userEvent.click(screen.getByRole('link', { name: 'CONTENT PIPELINE - ZIM' }));
    expect(screen.getByTestId('where')).toHaveTextContent(`/spaces/${IDS.spaceA}/folders/${IDS.folderZim}`);

    await userEvent.click(screen.getByRole('button', { name: 'Expand CONTENT PIPELINE - ZIM' }));
    await userEvent.click(screen.getByRole('link', { name: '25. EDAPTX' }));
    expect(screen.getByTestId('where')).toHaveTextContent(`/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}`);
  });

  it('a deep link (refresh) reveals and highlights the active list and its ancestors', async () => {
    renderTree('OWNER', `/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}`);
    const active = await screen.findByRole('link', { name: '25. EDAPTX' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Content Pipelines' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: '2. CONOR CONTENT' })).not.toHaveAttribute('aria-current');
  });

  it('highlights the active folder and the active space', async () => {
    const { unmount } = renderTree('OWNER', `/spaces/${IDS.spaceA}/folders/${IDS.folderZim}`);
    expect(await screen.findByRole('link', { name: 'CONTENT PIPELINE - ZIM' })).toHaveAttribute('aria-current', 'page');
    unmount();
    renderTree('OWNER', `/spaces/${IDS.spaceB}`);
    expect(await screen.findByRole('link', { name: 'Design' })).toHaveAttribute('aria-current', 'page');
  });

  it('remembers which nodes are open as a UI preference only', async () => {
    renderTree();
    await screen.findByText('Content Pipelines');
    await userEvent.click(screen.getByRole('button', { name: 'Expand Content Pipelines' }));
    expect(JSON.parse(window.localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY) ?? '[]')).toEqual([IDS.spaceA]);
  });

  it('restores the open nodes from the preference and ignores a corrupted one', async () => {
    window.localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, JSON.stringify([IDS.spaceA]));
    const { unmount } = renderTree();
    expect(await screen.findByText('CONTENT PIPELINE - ZIM')).toBeInTheDocument();
    unmount();
    window.localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, '{not json');
    renderTree();
    await screen.findByText('Content Pipelines');
    expect(screen.queryByText('CONTENT PIPELINE - ZIM')).not.toBeInTheDocument();
  });

  it('collapsed sidebar: one icon link per space with an accessible name', async () => {
    renderTree('OWNER', '/home', true);
    expect(await screen.findByRole('link', { name: 'Content Pipelines' })).toHaveAttribute('href', `/spaces/${IDS.spaceA}`);
    expect(screen.getByRole('link', { name: 'Design' })).toBeInTheDocument();
    expect(screen.queryByText('Spaces')).not.toBeInTheDocument();
  });

  it('collapsed sidebar with no spaces shows a quiet placeholder icon', async () => {
    db.getWorkspaceHierarchy.mockResolvedValue([]);
    const { container } = renderTree('OWNER', '/home', true);
    await waitFor(() => expect(db.getWorkspaceHierarchy).toHaveBeenCalled());
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
});

describe('SpacesTree: role-aware controls', () => {
  it('Owner/Admin get the "+" button; Production Manager and Editor do not', async () => {
    const { unmount } = renderTree('ADMIN');
    expect(await screen.findByRole('button', { name: 'New space' })).toBeInTheDocument();
    unmount();
    const pm = renderTree('PRODUCTION_MANAGER');
    await screen.findByText('Content Pipelines');
    expect(screen.queryByRole('button', { name: 'New space' })).not.toBeInTheDocument();
    pm.unmount();
  });

  it('Editors get no action menus at all', async () => {
    renderTree('EDITOR');
    await screen.findByText('Content Pipelines');
    expect(screen.queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument();
  });

  it('Owner space menu: create, edit, move and delete', async () => {
    renderTree('OWNER');
    await screen.findByText('Content Pipelines');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Content Pipelines' }));
    const menu = await screen.findByRole('menu');
    for (const item of ['New folder', 'New list', 'Edit space', 'Move up', 'Move down', 'Delete space']) {
      expect(within(menu).getByRole('menuitem', { name: item })).toBeInTheDocument();
    }
    // first space cannot move up
    expect(within(menu).getByRole('menuitem', { name: 'Move up' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('Production Manager can add and edit folders and lists, but not edit or delete spaces', async () => {
    renderTree('PRODUCTION_MANAGER');
    await screen.findByText('Content Pipelines');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Content Pipelines' }));
    let menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'New folder' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Edit space' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Delete space' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('button', { name: 'Expand Content Pipelines' }));
    await userEvent.click(screen.getByRole('button', { name: 'Actions for CONTENT PIPELINE - ZIM' }));
    menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'New list' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Edit folder' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Delete folder' })).not.toBeInTheDocument();
  });

  it('Admin can delete lists and folders, Production Manager cannot', async () => {
    const admin = renderTree('ADMIN', `/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for 25. EDAPTX' }));
    expect(await screen.findByRole('menuitem', { name: 'Delete list' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    admin.unmount();

    renderTree('PRODUCTION_MANAGER', `/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for 25. EDAPTX' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Edit list' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Delete list' })).not.toBeInTheDocument();
  });
});

describe('SpacesTree: reordering', () => {
  it('Move down sends the complete new sibling order to the database', async () => {
    renderTree('OWNER');
    await screen.findByText('Content Pipelines');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Content Pipelines' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move down' }));
    await waitFor(() => expect(db.reorderHierarchy).toHaveBeenCalledWith('space', [IDS.spaceB, IDS.spaceA]));
  });

  it('reorders lists inside a folder', async () => {
    renderTree('PRODUCTION_MANAGER', `/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for 25. EDAPTX' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move down' }));
    await waitFor(() => expect(db.reorderHierarchy).toHaveBeenCalledWith('list', [IDS.listConor, IDS.listEdaptx]));
  });

  it('refreshes the tree after a reorder even when it fails', async () => {
    db.reorderHierarchy.mockRejectedValue(new Error('You do not have permission to reorder these items.'));
    renderTree('OWNER');
    await screen.findByText('Content Pipelines');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Content Pipelines' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move down' }));
    await waitFor(() => expect(db.getWorkspaceHierarchy).toHaveBeenCalledTimes(2));
  });
});

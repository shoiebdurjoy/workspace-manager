import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import SpacePage from '../SpacePage';
import FolderPage from '../FolderPage';
import ListPage from '../ListPage';
import Home from '../Home';
import { AppHeader } from '@/components/layout/AppHeader';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { TooltipProvider } from '@/components/ui/tooltip';
import { makeAuth, renderWithAuth } from '@/test/auth-utils';
import type { createDatabaseMock } from '@/test/database-mock';
import * as dbModule from '@/database';
import { IDS, makeTree } from '@/test/hierarchy-fixtures';
import type { TbbRole } from '@/types/database';

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

const Where: React.FC = () => <span data-testid="where">{useLocation().pathname}</span>;

const routes = (
  <>
    <Routes>
      <Route path="/spaces/:spaceId" element={<SpacePage />} />
      <Route path="/spaces/:spaceId/folders/:folderId" element={<FolderPage />} />
      <Route path="/spaces/:spaceId/lists/:listId" element={<ListPage />} />
      <Route path="/home" element={<div>home page</div>} />
    </Routes>
    <Where />
  </>
);

const renderAt = (route: string, role: TbbRole = 'OWNER') => renderWithAuth(routes, { auth: makeAuth(role), route });

beforeEach(() => {
  vi.clearAllMocks();
  db.getWorkspaceHierarchy.mockResolvedValue(makeTree());
  db.getWorkspaceMembers.mockResolvedValue([]);
  db.listTasks.mockResolvedValue({ items: [], total: 0 });
  db.listInvitations.mockResolvedValue([]);
  db.listTeams.mockResolvedValue([]);
  db.listTeamMembers.mockResolvedValue([]);
});

describe('Space page /spaces/:spaceId', () => {
  it('shows the space, its folders with list counts, and its direct lists', async () => {
    renderAt(`/spaces/${IDS.spaceA}`);
    expect(await screen.findByRole('heading', { name: 'Content Pipelines' })).toBeInTheDocument();
    expect(screen.getByText('Client video pipelines')).toBeInTheDocument();
    const folders = screen.getByRole('region', { name: 'Folders' });
    expect(within(folders).getByRole('link', { name: /CONTENT PIPELINE - ZIM/ })).toHaveAttribute(
      'href', `/spaces/${IDS.spaceA}/folders/${IDS.folderZim}`
    );
    expect(within(folders).getByText('2 lists')).toBeInTheDocument();
    expect(within(folders).getByText('0 lists')).toBeInTheDocument();
    const lists = screen.getByRole('region', { name: 'Lists' });
    expect(within(lists).getByRole('link', { name: /Raw Intake/ })).toHaveAttribute('href', `/spaces/${IDS.spaceA}/lists/${IDS.listIntake}`);
    expect(document.title).toBe('Content Pipelines · TBB Workspace');
  });

  it('managers see create buttons; editors do not', async () => {
    const { unmount } = renderAt(`/spaces/${IDS.spaceA}`, 'PRODUCTION_MANAGER');
    expect(await screen.findByRole('button', { name: 'New folder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New list' })).toBeInTheDocument();
    unmount();
    renderAt(`/spaces/${IDS.spaceA}`, 'EDITOR');
    await screen.findByRole('heading', { name: 'Content Pipelines' });
    expect(screen.queryByRole('button', { name: 'New folder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New list' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Actions for Content Pipelines/ })).not.toBeInTheDocument();
  });

  it('an empty space has a proper empty state with the right call to action', async () => {
    const { unmount } = renderAt(`/spaces/${IDS.spaceB}`, 'OWNER');
    expect(await screen.findByText('This space is empty')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New folder' }).length).toBeGreaterThan(0);
    unmount();
    renderAt(`/spaces/${IDS.spaceB}`, 'EDITOR');
    expect(await screen.findByText('This space is empty')).toBeInTheDocument();
    expect(screen.getByText(/can add folders and lists/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New folder' })).not.toBeInTheDocument();
  });

  it('opening New folder from the page uses the shared dialog', async () => {
    renderAt(`/spaces/${IDS.spaceA}`);
    await userEvent.click(await screen.findByRole('button', { name: 'New folder' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('New folder');
  });
});

describe('Folder page /spaces/:spaceId/folders/:folderId', () => {
  it('shows the folder, a link back to its space and its lists', async () => {
    renderAt(`/spaces/${IDS.spaceA}/folders/${IDS.folderZim}`);
    expect(await screen.findByRole('heading', { name: 'CONTENT PIPELINE - ZIM' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Location' })).getByRole('link', { name: 'Content Pipelines' })).toHaveAttribute('href', `/spaces/${IDS.spaceA}`);
    expect(screen.getByRole('link', { name: /25\. EDAPTX/ })).toHaveAttribute('href', `/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}`);
    expect(screen.getByRole('link', { name: /2\. CONOR CONTENT/ })).toBeInTheDocument();
  });

  it('an empty folder has an empty state; New list needs the permission', async () => {
    const { unmount } = renderAt(`/spaces/${IDS.spaceA}/folders/${IDS.folderMyla}`, 'PRODUCTION_MANAGER');
    expect(await screen.findByText('No lists in this folder')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New list' }).length).toBeGreaterThan(0);
    unmount();
    renderAt(`/spaces/${IDS.spaceA}/folders/${IDS.folderMyla}`, 'QC_SPECIALIST');
    expect(await screen.findByText('No lists in this folder')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New list' })).not.toBeInTheDocument();
  });

  it('a folder under the WRONG space is not found (ids cannot be mixed)', async () => {
    renderAt(`/spaces/${IDS.spaceB}/folders/${IDS.folderZim}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('Folder not found');
  });
});

describe('List page /spaces/:spaceId/lists/:listId', () => {
  it('shows the list, its location and an honest empty task area (tasks come from the database only)', async () => {
    renderAt(`/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}`);
    expect(await screen.findByRole('heading', { name: '25. EDAPTX' })).toBeInTheDocument();
    const trail = screen.getByRole('navigation', { name: 'Location' });
    expect(within(trail).getByRole('link', { name: 'Content Pipelines' })).toBeInTheDocument();
    expect(within(trail).getByRole('link', { name: 'CONTENT PIPELINE - ZIM' })).toHaveAttribute(
      'href', `/spaces/${IDS.spaceA}/folders/${IDS.folderZim}`
    );
    expect(await screen.findByText('No tasks in this list yet')).toBeInTheDocument();
    expect(db.listTasks).toHaveBeenCalledWith(IDS.listEdaptx, 0);
    // no invented tasks, assignees, statuses or counts
    expect(screen.queryByRole('row')).not.toBeInTheDocument();
    expect(screen.queryByText(/QC - |IN EDIT|assigned/i)).not.toBeInTheDocument();
  });

  it('a list directly in a space has no folder in its trail', async () => {
    renderAt(`/spaces/${IDS.spaceA}/lists/${IDS.listIntake}`);
    expect(await screen.findByRole('heading', { name: 'Raw Intake' })).toBeInTheDocument();
    const trail = screen.getByRole('navigation', { name: 'Location' });
    expect(within(trail).queryByText('CONTENT PIPELINE - ZIM')).not.toBeInTheDocument();
  });

  it('the list menu offers edit/delete according to the role', async () => {
    const { unmount } = renderAt(`/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}`, 'ADMIN');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for 25. EDAPTX' }));
    expect(await screen.findByRole('menuitem', { name: 'Delete list' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    unmount();
    renderAt(`/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}`, 'EDITOR');
    await screen.findByRole('heading', { name: '25. EDAPTX' });
    expect(screen.queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument();
  });
});

describe('access, ids and failure states (all deep links)', () => {
  it('shows a loading state while the tree loads', () => {
    db.getWorkspaceHierarchy.mockReturnValue(new Promise(() => undefined));
    renderAt(`/spaces/${IDS.spaceA}`);
    expect(screen.getByText(/Loading space/i)).toBeInTheDocument();
  });

  it('unknown but well-formed ids: not found (same screen as "no access", nothing leaked)', async () => {
    renderAt(`/spaces/${IDS.missing}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('Space not found');
    expect(screen.getByRole('alert')).toHaveTextContent('may have been deleted, or you may not have access');
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/home');
  });

  it('a list id inside the wrong space is not found', async () => {
    renderAt(`/spaces/${IDS.spaceB}/lists/${IDS.listEdaptx}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('List not found');
  });

  it('malformed ids are not found and are never put into a query', async () => {
    renderAt(`/spaces/not-a-uuid/lists/${encodeURIComponent("1' OR '1'='1")}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('List not found');
    expect(db.getWorkspaceHierarchy).toHaveBeenCalledTimes(1); // only the workspace-scoped tree query
    expect(db.getWorkspaceHierarchy).toHaveBeenCalledWith('ws-1');
  });

  it('client viewers have no access to the hierarchy and nothing is requested', async () => {
    renderAt(`/spaces/${IDS.spaceA}`, 'CLIENT_VIEWER');
    expect(await screen.findByRole('alert')).toHaveTextContent('No access');
    expect(db.getWorkspaceHierarchy).not.toHaveBeenCalled();
  });

  it('load failures show an error with retry', async () => {
    db.getWorkspaceHierarchy.mockRejectedValueOnce(new Error('Failed to load spaces: connection failure'));
    renderAt(`/spaces/${IDS.spaceA}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('connection failure');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('heading', { name: 'Content Pipelines' })).toBeInTheDocument();
  });
});

describe('header breadcrumbs', () => {
  const header = (route: string) =>
    renderWithAuth(
      <Routes>
        <Route
          path="*"
          element={<AppHeader onToggleMobileSidebar={() => undefined} onOpenSearch={() => undefined} />}
        />
        <Route path="/spaces/:spaceId/lists/:listId" element={<AppHeader onToggleMobileSidebar={() => undefined} onOpenSearch={() => undefined} />} />
      </Routes>,
      { auth: makeAuth('OWNER'), route }
    );

  it('shows workspace > space > folder > list from the real tree', async () => {
    header(`/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}`);
    const nav = (await screen.findAllByRole('navigation'))[0];
    await waitFor(() => expect(within(nav).getByText('25. EDAPTX')).toBeInTheDocument());
    for (const label of ['Think Big Brand', 'Content Pipelines', 'CONTENT PIPELINE - ZIM']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(within(nav).getByText('25. EDAPTX')).toHaveAttribute('aria-current', 'page');
  });

  it('plain pages keep their title', async () => {
    header('/team');
    expect(await screen.findByText('Think Big Brand')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
  });
});

describe('command palette', () => {
  const palette = (role: TbbRole = 'OWNER') =>
    renderWithAuth(
      <TooltipProvider>
        <Routes>
          <Route path="*" element={<><CommandPalette open onOpenChange={() => undefined} /><Where /></>} />
        </Routes>
      </TooltipProvider>,
      { auth: makeAuth(role), route: '/home' }
    );

  it('lists the real spaces, folders and lists and jumps to them', async () => {
    palette();
    expect(await screen.findByText('Spaces, folders and lists')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Content Pipelines' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'CONTENT PIPELINE - ZIM in Content Pipelines' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /25\. EDAPTX/ }));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(`/spaces/${IDS.spaceA}/lists/${IDS.listEdaptx}`)
    );
  });

  it('filters as you type', async () => {
    palette();
    await screen.findByText('Spaces, folders and lists');
    await userEvent.type(screen.getByPlaceholderText(/Go to a page/), 'conor');
    await waitFor(() => expect(screen.queryByRole('option', { name: /25\. EDAPTX/ })).not.toBeInTheDocument());
    expect(screen.getByRole('option', { name: /2\. CONOR CONTENT/ })).toBeInTheDocument();
  });

  it('has no hierarchy group for client viewers', async () => {
    palette('CLIENT_VIEWER');
    await screen.findByText('Home');
    expect(screen.queryByText('Spaces, folders and lists')).not.toBeInTheDocument();
  });
});

describe('Home spaces overview', () => {
  const home = (role: TbbRole) => renderWithAuth(<><Home /><Where /></>, { auth: makeAuth(role), route: '/home' });

  it('lists the real spaces and totals', async () => {
    home('OWNER');
    const region = await screen.findByRole('region', { name: 'Spaces' });
    expect(await within(region).findByRole('link', { name: /Content Pipelines/ })).toHaveAttribute('href', `/spaces/${IDS.spaceA}`);
    expect(within(region).getByText('2 folders')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Spaces', { selector: 'p' }).previousElementSibling).toHaveTextContent('2'));
    expect(screen.getByText('Lists', { selector: 'p' }).previousElementSibling).toHaveTextContent('3');
  });

  it('only Owner/Admin get "New space"', async () => {
    const { unmount } = home('ADMIN');
    expect(await screen.findByRole('button', { name: 'New space' })).toBeInTheDocument();
    unmount();
    home('PRODUCTION_MANAGER');
    await screen.findByRole('region', { name: 'Spaces' });
    expect(screen.queryByRole('button', { name: 'New space' })).not.toBeInTheDocument();
  });

  it('empty and error states', async () => {
    db.getWorkspaceHierarchy.mockResolvedValueOnce([]);
    const { unmount } = home('OWNER');
    expect(await screen.findByText(/Create one to start organising client pipelines/)).toBeInTheDocument();
    unmount();
    db.getWorkspaceHierarchy.mockRejectedValue(new Error('boom'));
    home('OWNER');
    expect(await screen.findByText(/Spaces could not be loaded/)).toBeInTheDocument();
  });

  it('client viewers see no spaces section', () => {
    home('CLIENT_VIEWER');
    expect(screen.queryByRole('region', { name: 'Spaces' })).not.toBeInTheDocument();
  });
});

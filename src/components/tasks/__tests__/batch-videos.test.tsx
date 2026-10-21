import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BatchVideosSection from '../BatchVideosSection';
import { makeAuth, renderWithAuth } from '@/test/auth-utils';
import type { createDatabaseMock } from '@/test/database-mock';
import { TBB_WORKFLOW } from '@/test/workflow-fixture';
import { MEMBERS, PEOPLE, makeDetail, makeSummary } from '@/test/task-fixtures';
import * as dbModule from '@/database';
import type { TbbRole } from '@/types/database';

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

const BATCH = 'batch-1';
const path = (id: string) => `/tasks/${id}`;

const VIDEOS = [
  makeSummary({ id: 'v1', title: 'Video 1 - hook', status: 'COMPLETED', editorId: PEOPLE.editor2, dueDate: '2026-10-12T12:00:00Z' }),
  makeSummary({ id: 'v2', title: 'Video 2 - recap', editorId: null }),
];

const show = (role: TbbRole, task = { id: BATCH, parentId: null as string | null }) =>
  renderWithAuth(<BatchVideosSection task={task} taskPath={path} />, { auth: makeAuth(role) });

beforeEach(() => {
  vi.clearAllMocks();
  db.getWorkflow.mockResolvedValue(TBB_WORKFLOW);
  db.getWorkspaceMembers.mockResolvedValue(MEMBERS);
  db.listBatchVideos.mockResolvedValue(VIDEOS);
  db.getBatchProgress.mockResolvedValue(new Map([[BATCH, { total: 2, finished: 1 }]]));
});

describe('BatchVideosSection', () => {
  it('a batch shows its progress and one row per video with stage, editor and link', async () => {
    show('PRODUCTION_MANAGER');
    expect(await screen.findByText('1 of 2 videos finished')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Videos finished' })).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByRole('link', { name: 'Video 1 - hook' })).toHaveAttribute('href', '/tasks/v1');
    expect(screen.getByRole('link', { name: 'Video 2 - recap' })).toHaveAttribute('href', '/tasks/v2');
    expect(await screen.findByText('Eva Editor')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(db.listBatchVideos).toHaveBeenCalledWith(BATCH);
  });

  it('a video shows the batch it is part of, as a link', async () => {
    db.getTask.mockResolvedValue(makeDetail({ id: 'batch-parent', title: 'CONNECTORS CAN | MEDICUS ELITE' }));
    show('PRODUCTION_MANAGER', { id: 'v1', parentId: 'batch-parent' });
    const link = await screen.findByRole('link', { name: 'CONNECTORS CAN | MEDICUS ELITE' });
    expect(link).toHaveAttribute('href', '/tasks/batch-parent');
    expect(screen.getByText(/Part of/)).toBeInTheDocument();
    expect(db.listBatchVideos).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Add video')).not.toBeInTheDocument();
  });

  it('adds a video with Enter, then clears the input', async () => {
    db.createBatchVideo.mockResolvedValue({ id: 'v3', title: 'Video 3' });
    show('PRODUCTION_MANAGER');
    const input = await screen.findByLabelText('Add video');
    await userEvent.type(input, 'Video 3{Enter}');
    await waitFor(() => expect(db.createBatchVideo).toHaveBeenCalledWith(BATCH, 'Video 3', undefined, undefined));
    await waitFor(() => expect(input).toHaveValue(''));
    await waitFor(() => expect(db.listBatchVideos.mock.calls.length).toBeGreaterThan(1));
  });

  it('keeps the title and shows a message when the video cannot be added', async () => {
    db.createBatchVideo.mockRejectedValue(new Error('You do not have permission to add the video.'));
    show('PRODUCTION_MANAGER');
    const input = await screen.findByLabelText('Add video');
    await userEvent.type(input, 'Video 3{Enter}');
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('You do not have permission to add the video.'));
    expect(input).toHaveValue('Video 3');
  });

  it('a blank title is not sent', async () => {
    show('PRODUCTION_MANAGER');
    const input = await screen.findByLabelText('Add video');
    await userEvent.type(input, '   {Enter}');
    expect(db.createBatchVideo).not.toHaveBeenCalled();
  });

  it('a role that cannot create tasks sees the videos but no input', async () => {
    show('EDITOR');
    expect(await screen.findByText('1 of 2 videos finished')).toBeInTheDocument();
    expect(screen.queryByLabelText('Add video')).not.toBeInTheDocument();
  });

  it('is hidden for a task with no videos when the person cannot add any', async () => {
    db.listBatchVideos.mockResolvedValue([]);
    db.getBatchProgress.mockResolvedValue(new Map());
    const { container } = show('EDITOR');
    await waitFor(() => expect(db.listBatchVideos).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows an empty state with the input for a manager', async () => {
    db.listBatchVideos.mockResolvedValue([]);
    db.getBatchProgress.mockResolvedValue(new Map());
    show('OWNER');
    expect(await screen.findByText(/No videos yet/)).toBeInTheDocument();
    expect(screen.getByLabelText('Add video')).toBeInTheDocument();
  });

  it('shows an error with a retry when the videos cannot be loaded', async () => {
    db.listBatchVideos.mockRejectedValueOnce(new Error('boom'));
    show('OWNER');
    expect(await screen.findByText('The videos could not be loaded.')).toBeInTheDocument();
    db.listBatchVideos.mockResolvedValue(VIDEOS);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Video 1 - hook' })).toBeInTheDocument();
  });
});

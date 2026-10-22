import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CustomFieldsSection from '../CustomFieldsSection';
import CustomFieldsManager from '@/components/settings/CustomFieldsManager';
import Settings from '@/pages/Settings';
import { makeAuth, renderWithAuth } from '@/test/auth-utils';
import type { createDatabaseMock } from '@/test/database-mock';
import * as dbModule from '@/database';
import type { CustomField, CustomFieldValue, TbbRole } from '@/types/database';

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

const TASK = 'task-1';
const base = { workspaceId: 'ws-1', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', isRequired: false, defaultValue: null, folderIds: null };
const FIELDS: CustomField[] = [
  { ...base, id: 'f-note', name: 'A) Note', type: 'text', options: null, position: 0 },
  { ...base, id: 'f-loom', name: 'F) Loom video', type: 'url', options: null, position: 1 },
  { ...base, id: 'f-hook', name: 'HOOK VARIATION', type: 'number', options: null, position: 2 },
  { ...base, id: 'f-format', name: 'Video Format Needed', type: 'dropdown', options: ['16:9', '9:16'], position: 3 },
  { ...base, id: 'f-shoot', name: 'Shoot date', type: 'date', options: null, position: 4 },
];

function setup(values: Array<[string, CustomFieldValue]> = [], fields: CustomField[] = FIELDS) {
  db.listCustomFields.mockResolvedValue(fields);
  db.listTaskFieldValues.mockResolvedValue(new Map(values));
}

const show = (role: TbbRole, assigned = false) => renderWithAuth(<CustomFieldsSection taskId={TASK} isAssignedEditor={assigned} />, { auth: makeAuth(role) });

beforeEach(() => {
  vi.clearAllMocks();
  db.setTaskFieldValue.mockResolvedValue(undefined);
});

describe('CustomFieldsSection', () => {
  it('is hidden when the workspace has no fields', async () => {
    setup([], []);
    const { container } = show('OWNER');
    await waitFor(() => expect(db.listCustomFields).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('a manager sees an editor for every field and saves a text value on blur', async () => {
    setup([['f-note', 'old']]);
    show('PRODUCTION_MANAGER');
    const input = await screen.findByRole('textbox', { name: 'A) Note' });
    expect(input).toHaveValue('old');
    await userEvent.clear(input);
    await userEvent.type(input, 'new text');
    fireEvent.blur(input);
    await waitFor(() => expect(db.setTaskFieldValue).toHaveBeenCalledWith(TASK, 'f-note', 'new text'));
  });

  it('clearing a value saves null (the row is deleted)', async () => {
    setup([['f-note', 'old']]);
    show('ADMIN');
    const input = await screen.findByRole('textbox', { name: 'A) Note' });
    await userEvent.clear(input);
    fireEvent.blur(input);
    await waitFor(() => expect(db.setTaskFieldValue).toHaveBeenCalledWith(TASK, 'f-note', null));
  });

  it('a number is saved as a number and a bad one is explained and not sent', async () => {
    setup();
    show('QC_SPECIALIST');
    const input = await screen.findByRole('textbox', { name: 'HOOK VARIATION' });
    await userEvent.type(input, 'abc');
    fireEvent.blur(input);
    expect(await screen.findByText('Enter a number.')).toBeInTheDocument();
    expect(db.setTaskFieldValue).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, '12{Enter}');
    await waitFor(() => expect(db.setTaskFieldValue).toHaveBeenCalledWith(TASK, 'f-hook', 12));
  });

  it('a link must be http(s); a saved link has an open icon', async () => {
    setup([['f-loom', 'https://www.loom.com/share/abc']]);
    show('OWNER');
    expect(await screen.findByRole('link', { name: /Open F\) Loom video/ })).toHaveAttribute('href', 'https://www.loom.com/share/abc');
    const input = screen.getByRole('textbox', { name: 'F) Loom video' });
    await userEvent.clear(input);
    await userEvent.type(input, 'javascript:alert(1)');
    fireEvent.blur(input);
    expect(await screen.findByText(/starts with http/)).toBeInTheDocument();
    expect(db.setTaskFieldValue).not.toHaveBeenCalled();
  });

  it('a date is saved as YYYY-MM-DD', async () => {
    setup();
    show('OWNER');
    const input = await screen.findByLabelText('Shoot date');
    fireEvent.change(input, { target: { value: '2030-02-28' } });
    await waitFor(() => expect(db.setTaskFieldValue).toHaveBeenCalledWith(TASK, 'f-shoot', '2030-02-28'));
  });

  it('shows the dropdown value', async () => {
    setup([['f-format', '9:16']]);
    show('OWNER');
    expect(await screen.findByRole('combobox', { name: 'Video Format Needed' })).toHaveTextContent('9:16');
  });

  it('puts the old value back and says why when the database refuses', async () => {
    setup([['f-note', 'old']]);
    db.setTaskFieldValue.mockRejectedValue(new Error('You do not have permission to save this field.'));
    show('OWNER');
    const input = await screen.findByRole('textbox', { name: 'A) Note' });
    await userEvent.clear(input);
    await userEvent.type(input, 'nope');
    fireEvent.blur(input);
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('You do not have permission to save this field.'));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'A) Note' })).toHaveValue('old'));
  });

  it('an editor on their own task can edit; on someone else\'s task they see read-only text', async () => {
    setup([['f-note', 'hello']]);
    const own = show('EDITOR', true);
    expect(await screen.findByRole('textbox', { name: 'A) Note' })).toBeEnabled();
    own.unmount();
    show('EDITOR', false);
    expect(await screen.findByText('hello')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('a read-only link still opens, and empty fields say Not set', async () => {
    setup([['f-loom', 'https://www.loom.com/share/abc']]);
    show('EDITOR', false);
    expect(await screen.findByRole('link', { name: /Open F\) Loom video/ })).toBeInTheDocument();
    expect(screen.getAllByText('Not set').length).toBeGreaterThan(0);
  });

  it('a client viewer cannot edit', async () => {
    setup([['f-note', 'hello']]);
    show('CLIENT_VIEWER', true);
    await waitFor(() => expect(db.listCustomFields).not.toHaveBeenCalled());
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('"Hide empty fields" hides the fields without a value', async () => {
    setup([['f-note', 'hello']]);
    show('OWNER');
    await screen.findByRole('textbox', { name: 'A) Note' });
    await userEvent.click(screen.getByRole('button', { name: 'Hide empty fields' }));
    expect(screen.getByRole('textbox', { name: 'A) Note' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'HOOK VARIATION' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show empty fields' }));
    expect(screen.getByRole('textbox', { name: 'HOOK VARIATION' })).toBeInTheDocument();
  });
});

describe('CustomFieldsManager', () => {
  const field = (over: Partial<CustomField>): CustomField => ({ ...base, id: 'new', name: 'X', type: 'text', options: null, position: 0, ...over });

  it('lists the fields with their type and choices', async () => {
    setup();
    renderWithAuth(<CustomFieldsManager />, { auth: makeAuth('OWNER') });
    expect(await screen.findByText('HOOK VARIATION')).toBeInTheDocument();
    expect(screen.getByText('Dropdown: 16:9, 9:16')).toBeInTheDocument();
  });

  it('adds a text field', async () => {
    setup([], []);
    db.createCustomField.mockResolvedValue(field({ name: 'B) Brand Guidelines' }));
    renderWithAuth(<CustomFieldsManager />, { auth: makeAuth('ADMIN') });
    await userEvent.type(await screen.findByLabelText('Field name'), 'B) Brand Guidelines');
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));
    await waitFor(() => expect(db.createCustomField).toHaveBeenCalledWith('ws-1', { name: 'B) Brand Guidelines', type: 'text', options: [], position: 0 }));
  });

  it('a dropdown needs choices, one per line', async () => {
    setup([], []);
    db.createCustomField.mockResolvedValue(field({ type: 'dropdown', options: ['a', 'b'] }));
    renderWithAuth(<CustomFieldsManager />, { auth: makeAuth('OWNER') });
    await userEvent.type(await screen.findByLabelText('Field name'), 'Format');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'dropdown');
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(await screen.findByText('Add at least one choice.')).toBeInTheDocument();
    expect(db.createCustomField).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Choices'), 'a{Enter}b');
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));
    await waitFor(() => expect(db.createCustomField).toHaveBeenCalledWith('ws-1', { name: 'Format', type: 'dropdown', options: ['a', 'b'], position: 0 }));
  });

  it('refuses a name another field already has', async () => {
    setup();
    renderWithAuth(<CustomFieldsManager />, { auth: makeAuth('OWNER') });
    await userEvent.type(await screen.findByLabelText('Field name'), 'hook variation');
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(await screen.findByText('Another field already has this name.')).toBeInTheDocument();
    expect(db.createCustomField).not.toHaveBeenCalled();
  });

  it('renames a field and edits its choices; the type is locked', async () => {
    setup();
    db.updateCustomField.mockResolvedValue(FIELDS[3]);
    renderWithAuth(<CustomFieldsManager />, { auth: makeAuth('PRODUCTION_MANAGER') });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Video Format Needed' }));
    expect(screen.getByDisplayValue('Dropdown')).toBeDisabled();
    const name = screen.getByDisplayValue('Video Format Needed');
    await userEvent.clear(name);
    await userEvent.type(name, 'Format');
    await userEvent.type(screen.getByLabelText('Choices'), '{Enter}1:1');
    await userEvent.click(screen.getByRole('button', { name: 'Save field' }));
    await waitFor(() => expect(db.updateCustomField).toHaveBeenCalledWith('f-format', { name: 'Format', options: ['16:9', '9:16', '1:1'], isRequired: false, defaultValue: null, folderIds: [] }));
  });

  it('deleting asks first and says how many values go with the field', async () => {
    setup();
    db.countFieldValues.mockResolvedValue(3);
    db.deleteCustomField.mockResolvedValue(undefined);
    renderWithAuth(<CustomFieldsManager />, { auth: makeAuth('OWNER') });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete HOOK VARIATION' }));
    expect(await screen.findByText(/its 3 saved values on tasks/)).toBeInTheDocument();
    expect(db.deleteCustomField).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete field' }));
    await waitFor(() => expect(db.deleteCustomField).toHaveBeenCalledWith('f-hook'));
  });

  it('moves a field down', async () => {
    setup();
    renderWithAuth(<CustomFieldsManager />, { auth: makeAuth('OWNER') });
    await userEvent.click(await screen.findByRole('button', { name: 'Move A) Note down' }));
    await waitFor(() => expect(db.reorderCustomFields).toHaveBeenCalledWith(['f-loom', 'f-note', 'f-hook', 'f-format', 'f-shoot']));
  });
});

describe('Settings page', () => {
  it.each(['OWNER', 'ADMIN', 'PRODUCTION_MANAGER'] as TbbRole[])('%s manages custom fields', async (role) => {
    setup();
    renderWithAuth(<Settings />, { auth: makeAuth(role) });
    // tucked away until opened; Owner / Admin also get the status editor, so they pick the fields tab
    expect(screen.queryByRole('region', { name: 'Custom fields' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Customize workspace/ }));
    // everyone who manages fields also gets the Tags tab; only Owner / Admin get statuses and features
    expect(screen.getByRole('tab', { name: 'Tags' })).toBeInTheDocument();
    expect(!!screen.queryByRole('tab', { name: 'Statuses & moves' })).toBe(role !== 'PRODUCTION_MANAGER');
    expect(!!screen.queryByRole('tab', { name: 'Features' })).toBe(role !== 'PRODUCTION_MANAGER');
    fireEvent.click(screen.getByRole('tab', { name: 'Custom fields' }));
    expect(await screen.findByRole('region', { name: 'Custom fields' })).toBeInTheDocument();
  });

  it.each(['QC_SPECIALIST', 'EDITOR', 'CLIENT_VIEWER'] as TbbRole[])('%s does not see the manager', (role) => {
    setup();
    renderWithAuth(<Settings />, { auth: makeAuth(role) });
    expect(screen.queryByRole('region', { name: 'Custom fields' })).not.toBeInTheDocument();
  });
});

import { describe, it, expect } from 'vitest';
import {
  DatabaseError,
  ConfigurationError,
  AuthenticationRequiredError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from '../errors';

describe('Database Domain Errors', () => {
  it('instantiates DatabaseError with message, code, and details', () => {
    const error = new DatabaseError('Query failed', 'PG_23505', { detail: 'Unique violation' });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.name).toBe('DatabaseError');
    expect(error.message).toBe('Query failed');
    expect(error.code).toBe('PG_23505');
    expect(error.details).toEqual({ detail: 'Unique violation' });
  });

  it('instantiates ConfigurationError with CONFIG_ERROR code', () => {
    const error = new ConfigurationError('Missing URL');
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.name).toBe('ConfigurationError');
    expect(error.code).toBe('CONFIG_ERROR');
  });

  it('instantiates AuthenticationRequiredError with AUTH_REQUIRED code', () => {
    const error = new AuthenticationRequiredError();
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.name).toBe('AuthenticationRequiredError');
    expect(error.code).toBe('AUTH_REQUIRED');
  });

  it('instantiates NotFoundError with entity and identifier', () => {
    const error = new NotFoundError('Workspace', 'ws-123');
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.name).toBe('NotFoundError');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.entityName).toBe('Workspace');
    expect(error.identifier).toBe('ws-123');
    expect(error.message).toContain('Workspace with identifier "ws-123" was not found');
  });

  it('instantiates PermissionDeniedError with PERMISSION_DENIED code', () => {
    const error = new PermissionDeniedError('Unauthorized action');
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.name).toBe('PermissionDeniedError');
    expect(error.code).toBe('PERMISSION_DENIED');
  });

  it('instantiates ValidationError with VALIDATION_ERROR code', () => {
    const error = new ValidationError('Invalid slug');
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.name).toBe('ValidationError');
    expect(error.code).toBe('VALIDATION_ERROR');
  });
});

/**
 * Base database domain error
 */
export class DatabaseError extends Error {
  public readonly code?: string;
  public readonly details?: unknown;

  constructor(message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when database configuration is missing or invalid
 */
export class ConfigurationError extends DatabaseError {
  constructor(message: string, details?: unknown) {
    super(message, 'CONFIG_ERROR', details);
    this.name = 'ConfigurationError';
  }
}

/**
 * Thrown when an unauthenticated operation is attempted
 */
export class AuthenticationRequiredError extends DatabaseError {
  constructor(message = 'Authenticated session required for this database operation.') {
    super(message, 'AUTH_REQUIRED');
    this.name = 'AuthenticationRequiredError';
  }
}

/**
 * Thrown when an expected entity does not exist
 */
export class NotFoundError extends DatabaseError {
  public readonly entityName: string;
  public readonly identifier: string;

  constructor(entityName: string, identifier: string) {
    super(`${entityName} with identifier "${identifier}" was not found.`, 'NOT_FOUND', { entityName, identifier });
    this.name = 'NotFoundError';
    this.entityName = entityName;
    this.identifier = identifier;
  }
}

/**
 * Thrown when an operation violates Row Level Security or role permissions
 */
export class PermissionDeniedError extends DatabaseError {
  constructor(message = 'Permission denied by workspace authorization policies.') {
    super(message, 'PERMISSION_DENIED');
    this.name = 'PermissionDeniedError';
  }
}

/**
 * Thrown when schema constraints or domain validation fails
 */
export class ValidationError extends DatabaseError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

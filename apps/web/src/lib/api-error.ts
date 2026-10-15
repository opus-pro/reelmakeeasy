/**
 * Standardized API Error class for handling HTTP errors
 * Provides semantic getters for common error types to avoid
 * raw status code checks scattered throughout the codebase.
 */
export class ApiError extends Error {
  /** Bad request - invalid input (400) */
  get isBadRequest(): boolean {
    return this.status === 400
  }

  /** Forbidden - lacks permission (403) */
  get isForbidden(): boolean {
    return this.status === 403
  }

  /** Resource not found (404) */
  get isNotFound(): boolean {
    return this.status === 404
  }

  /** Rate limited (429) */
  get isRateLimited(): boolean {
    return this.status === 429
  }

  /** Server error (5xx) */
  get isServerError(): boolean {
    return this.status >= 500 && this.status < 600
  }

  /** Unauthorized - needs authentication (401) */
  get isUnauthorized(): boolean {
    return this.status === 401
  }

  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    /** Original response payload - preserves full error details for business logic */
    public readonly payload?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /**
   * Get typed payload with validation details (e.g., field-level errors)
   * Usage: error.getPayload<{ details: Array<{ field: string; message: string }> }>()
   */
  getPayload<T>(): T | undefined {
    return this.payload as T | undefined
  }
}

/**
 * Type guard to check if an error is an ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

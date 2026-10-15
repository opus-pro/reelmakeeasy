import { AxiosError } from 'axios'

/**
 * Extract error message from an error object with fallback handling
 * @param err - The error object (can be AxiosError, Error, or unknown)
 * @param defaultMessage - Default message to return if error message cannot be extracted
 * @returns Error message string
 */
export function getErrorMessage(err: unknown, defaultMessage = 'An error occurred'): string {
  // Handle AxiosError with response data
  if (err instanceof AxiosError) {
    // For 429 rate limit errors, try to extract message from response
    if (err.status === 429) {
      return err.response?.data?.message || defaultMessage
    }
    // For other AxiosErrors, try response message first, then error message
    return err.response?.data?.message || err.message || defaultMessage
  }

  // Handle standard Error objects
  if (err instanceof Error) {
    return err.message || defaultMessage
  }

  // Fallback for unknown error types
  return defaultMessage
}

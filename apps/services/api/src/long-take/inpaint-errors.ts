import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import {
  WorkflowUpdateFailedError,
  WorkflowUpdateRPCTimeoutOrCancelledError,
} from '@reelmakeeasy/workflow-engine/client'
import { ApplicationFailure, WorkflowNotFoundError } from '@reelmakeeasy/workflow-engine/common'

/**
 * Stable, low-cardinality label for an inpaint workflow error, for use as a
 * metric tag (see emitInpaintUpdate). Mirrors mapInpaintError's branches so the
 * tag value lines up with the HTTP mapping; kept here, next to mapInpaintError,
 * so the two cannot drift. Business-meaningful validator rejections (e.g. the
 * active-edit CONFLICT) arrive wrapped in WorkflowUpdateFailedError, so we read
 * the ApplicationFailure cause's type rather than a generic label.
 */
export function classifyInpaintError(error: unknown): string {
  if (error instanceof HttpException) {
    return 'http'
  }
  if (error instanceof WorkflowNotFoundError) {
    return 'NOT_FOUND'
  }
  if (error instanceof ApplicationFailure) {
    return error.type ?? 'APP_FAILURE'
  }
  if (error instanceof WorkflowUpdateFailedError) {
    const cause = error.cause
    return cause instanceof ApplicationFailure ? (cause.type ?? 'UPDATE_FAILED') : 'UPDATE_FAILED'
  }
  if (error instanceof WorkflowUpdateRPCTimeoutOrCancelledError) {
    return 'RPC_TIMEOUT'
  }
  return 'INTERNAL'
}

/**
 * Maps errors from inpaint workflow operations to semantic NestJS HTTP
 * exceptions. Re-throws as-is if it is already an HttpException (e.g. from
 * a nested call that already mapped the error).
 */
export function mapInpaintError(error: unknown): never {
  if (error instanceof HttpException) {
    throw error
  }

  // Session does not exist
  if (error instanceof WorkflowNotFoundError) {
    throw new NotFoundException('Inpaint session not found')
  }

  // Workflow validator rejected the update with a known business rule violation
  if (error instanceof ApplicationFailure && error.type === 'INVALID_STATE') {
    throw new BadRequestException(error.message)
  }

  // Validator rejected because finish signal was already received
  if (error instanceof ApplicationFailure && error.type === 'FINISHING') {
    throw new ConflictException(error.message)
  }

  // Update handler itself threw ApplicationFailure (e.g. activity nonRetryable failure surfaced)
  if (error instanceof WorkflowUpdateFailedError) {
    const cause = error.cause
    if (cause instanceof ApplicationFailure && cause.nonRetryable) {
      throw new BadRequestException(cause.message)
    }
    throw new ConflictException(`Update failed: ${error.message}`)
  }

  // The update call timed out waiting for the workflow to accept/reject it
  if (error instanceof WorkflowUpdateRPCTimeoutOrCancelledError) {
    throw new GatewayTimeoutException('Update request timed out, please retry')
  }

  throw new InternalServerErrorException(
    error instanceof Error ? error.message : 'Unexpected error',
  )
}

import { HttpException, HttpStatus } from '@nestjs/common'

export interface StandardErrorResponse {
  code: string
  details?: {
    constraints?: Record<string, unknown>
    field?: string
    value?: unknown
  }
  error: string
  message: string
  path?: string
  timestamp: string
  type: string
}

export class ValidationException extends HttpException {
  constructor(
    message: string,
    code: string,
    type: string,
    details?: {
      constraints?: Record<string, unknown>
      field?: string
      value?: unknown
    },
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    const errorResponse: StandardErrorResponse = {
      error: 'ValidationError',
      code,
      type,
      message,
      details,
      timestamp: new Date().toISOString(),
    }

    super(errorResponse, statusCode)
  }
}
export class AudioValidationException extends ValidationException {
  constructor(
    message: string,
    code: string,
    field?: string,
    constraints?: Record<string, unknown>,
  ) {
    super(message, code, 'AUDIO_VALIDATION', { field, constraints }, HttpStatus.BAD_REQUEST)
  }
}
export class FileValidationException extends ValidationException {
  constructor(
    message: string,
    code: string,
    field?: string,
    constraints?: Record<string, unknown>,
  ) {
    super(message, code, 'FILE_VALIDATION', { field, constraints }, HttpStatus.BAD_REQUEST)
  }
}
export class ImageValidationException extends ValidationException {
  constructor(
    message: string,
    code: string,
    field?: string,
    constraints?: Record<string, unknown>,
  ) {
    super(message, code, 'IMAGE_VALIDATION', { field, constraints }, HttpStatus.BAD_REQUEST)
  }
}

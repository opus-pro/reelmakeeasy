import { findLlmNotSetUp } from '@reelmakeeasy/common/utils/llm-not-set-up'
import { type ArgumentsHost, Catch, HttpStatus } from '@nestjs/common'
import { BaseExceptionFilter } from '@nestjs/core'
import type { Response } from 'express'

/**
 * A request whose LLM step had no AI to run on answers 409 with the error's own words (phase
 * 1's reason, ending "open Setup"), which the web shows as is. Everything else goes to Nest.
 */
@Catch()
export class LlmNotSetUpFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.getType() === 'http' ? host.switchToHttp().getResponse<Response>() : null
    // A response that already started (a stream) can't change its status: Nest deals with it.
    const notSetUp = res && !res.headersSent ? findLlmNotSetUp(exception) : null
    if (res === null || notSetUp === null) {
      super.catch(exception, host)
      return
    }
    res
      .status(HttpStatus.CONFLICT)
      .json({ message: notSetUp.message, statusCode: HttpStatus.CONFLICT })
  }
}

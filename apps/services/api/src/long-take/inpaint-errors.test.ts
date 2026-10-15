import { WorkflowUpdateRPCTimeoutOrCancelledError } from '@reelmakeeasy/workflow-engine/client'
import { WorkflowNotFoundError } from '@reelmakeeasy/workflow-engine/common'
import {
  GatewayTimeoutException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'

import { classifyInpaintError, mapInpaintError } from './inpaint-errors'

/** An error carrying a gRPC-style status code, as a hosted workflow service would throw. */
const withCode = (code: number) => Object.assign(new Error('UNAVAILABLE'), { code })

describe('classifyInpaintError', () => {
  it('labels the workflow errors the in-process engine raises', () => {
    expect(classifyInpaintError(new WorkflowNotFoundError('gone', 'wf'))).toBe('NOT_FOUND')
    expect(classifyInpaintError(new WorkflowUpdateRPCTimeoutOrCancelledError())).toBe('RPC_TIMEOUT')
  })

  it('labels any other error INTERNAL, including coded ones', () => {
    expect(classifyInpaintError(new Error('boom'))).toBe('INTERNAL')
    expect(classifyInpaintError(withCode(14))).toBe('INTERNAL')
  })
})

describe('mapInpaintError', () => {
  it('maps a missing workflow to 404 and an update timeout to 504', () => {
    expect(() => mapInpaintError(new WorkflowNotFoundError('gone', 'wf'))).toThrow(
      NotFoundException,
    )
    expect(() => mapInpaintError(new WorkflowUpdateRPCTimeoutOrCancelledError())).toThrow(
      GatewayTimeoutException,
    )
  })

  it('maps any other error to 500, including coded ones', () => {
    expect(() => mapInpaintError(withCode(5))).toThrow(InternalServerErrorException)
    expect(() => mapInpaintError(new Error('boom'))).toThrow(InternalServerErrorException)
  })
})

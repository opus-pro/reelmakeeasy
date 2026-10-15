jest.mock('./uip.service', () => ({ UipService: class {} }))

import { GUARDS_METADATA } from '@nestjs/common/constants'

import { LoopbackOnlyGuard } from '../agent/loopback-only.guard'

import { UipInternalController } from './uip-internal.controller'

describe('UipInternalController', () => {
  it('answers this computer only, whatever HOST says', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, UipInternalController)).toEqual([LoopbackOnlyGuard])
  })
})

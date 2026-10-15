import { BadRequestException } from '@nestjs/common'

/**
 * Distinct from transient failures so the deadline-driven auto-confirm can
 * extend instead of retrying to workflow death.
 */
export class UipEmptyPlanConfirmError extends BadRequestException {
  constructor() {
    super('Cannot confirm: the plan has not been built yet. Keep refining, then try again.')
    this.name = 'UipEmptyPlanConfirmError'
  }
}

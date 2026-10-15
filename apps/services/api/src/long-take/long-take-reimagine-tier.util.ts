import type { ReimagineModelSelectorTier } from '@reelmakeeasy/common/model-config/reimagine-model-tier'
import { BadRequestException } from '@nestjs/common'
import type { DebugSettings } from '@shared/types/project/debug-settings'

export function parseReimagineModelSelectorTier(
  value: unknown,
): ReimagineModelSelectorTier | undefined {
  if (value === undefined || value === 'standard' || value === 'standard_plus') {
    return value
  }
  throw new BadRequestException('modelSelectorTier must be standard or standard_plus')
}

export function readDebugSettings(debugSettings: unknown): DebugSettings {
  return debugSettings != null && typeof debugSettings === 'object' && !Array.isArray(debugSettings)
    ? (debugSettings as DebugSettings)
    : {}
}

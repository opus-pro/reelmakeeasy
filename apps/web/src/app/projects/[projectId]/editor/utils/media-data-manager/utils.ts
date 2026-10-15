import { FULL_RANGE_END, FULL_RANGE_START } from './constants'
import type { DeviceCapability, StorageQuota } from './types'

export function getDeviceCapability(): DeviceCapability {
  const memoryGB = (navigator as { deviceMemory?: number }).deviceMemory ?? 4
  const cpuCores = navigator.hardwareConcurrency ?? 4

  let tier: 'high' | 'low' | 'mid' = 'mid'
  if (memoryGB <= 2 || cpuCores <= 2) {
    tier = 'low'
  } else if (memoryGB >= 8 && cpuCores >= 8) {
    tier = 'high'
  }

  return { memoryGB, cpuCores, tier }
}

export async function getStorageQuota(): Promise<null | StorageQuota> {
  if (!navigator.storage?.estimate) {
    return null
  }
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate()
    return { quota, usage, available: quota - usage }
  } catch {
    return null
  }
}

export function isFullRange({ start, end }: { end: number; start: number }): boolean {
  return (start === FULL_RANGE_START && end === FULL_RANGE_END) || start > end
}

// WARNING: this file is used in many places, so don't add any new dependencies

// DON'T import any external logger here
const logger = console

/**
 * this file defines the getEnv to replace "process.env.XXX"
 */
class EnvValueNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvValueNotFoundError'
  }
}

/**
 * Return "" if it was not set, but will print a warning.
 * If you want to get rid of it, pass "" as the second param.
 */
export function getEnv(key: string, fallback?: string): string {
  const rawValue = process.env[key]

  const fallbackValue = fallback ?? ''
  if (rawValue == null && fallback == null) {
    // send warning
    logger.warn(`[getEnv] process.env['${key}'] is undefined, use default value "${fallbackValue}"`)
  }
  return rawValue ?? fallbackValue
}

/**
 * return env value as boolean
 * "true" --> true
 * "false" --> false
 */
export function getEnvAsBoolean(key: string, fallback?: boolean): boolean {
  const value = getEnvRequired(key, fallback == null ? undefined : `${fallback}`)
  return value === 'true'
}

/**
 * return env value as number (after parseFloat)
 * "1" --> 1
 * "1.1" --> 1.1
 * "1.1.1" --> NaN
 */
export function getEnvAsNumber(key: string, fallback?: number): number {
  const value = getEnvRequired(key, fallback == null ? undefined : `${fallback}`)
  const parsed = Number.parseFloat(value)
  if (Number.isNaN(parsed)) {
    logger.warn(`[getEnvAsNumber] ${key}=${value} is not a number, fallback to ${fallback}`)
  }
  return parsed
}

/** like getEnv, but will throw Error if no fallback & no value from env */
export function getEnvKeysAsBoolean(params: { envKeys: string[]; fallback: boolean }): boolean {
  for (const envKey of params.envKeys) {
    const raw = getEnv(envKey, '').trim().toLowerCase()
    if (!raw) {
      continue
    }
    if (['1', 'true', 'yes'].includes(raw)) {
      return true
    }
    if (['0', 'false', 'no'].includes(raw)) {
      return false
    }
  }
  return params.fallback
}

export function getEnvKeysAsNonNegativeInt(params: {
  envKeys: string[]
  fallback: number
  max: number
}): number {
  for (const envKey of params.envKeys) {
    const raw = Number.parseInt(getEnv(envKey, ''), 10)
    if (Number.isFinite(raw) && raw >= 0) {
      return Math.min(params.max, raw)
    }
  }

  return params.fallback
}

export function getEnvKeysAsPositiveInt(params: {
  envKeys: string[]
  fallback: number
  max: number
}): number {
  for (const envKey of params.envKeys) {
    const raw = Number.parseInt(getEnv(envKey, ''), 10)
    if (Number.isFinite(raw) && raw > 0) {
      return Math.min(params.max, raw)
    }
  }

  return params.fallback
}

export function getEnvRequired(key: string, fallback?: string): string {
  const rawValue = process.env[key]

  if (rawValue != null) {
    return rawValue
  }

  if (fallback == null) {
    throw new EnvValueNotFoundError(`${key} is required, got ${rawValue}`)
  }
  return fallback
}

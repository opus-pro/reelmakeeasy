/**
 * Story Mode circuit breaker policy resolution.
 *
 * Separates provider defaults from the breaker wiring. This makes it easy to
 * extend with per-lane or per-model policies later without touching the
 * breaker itself.
 */
import type { CircuitBreakerConfig } from '@reelmakeeasy/common/circuit-breaker'

// ---------------------------------------------------------------------------
// Provider categories
// ---------------------------------------------------------------------------

/** All known image providers */
export const IMAGE_PROVIDERS = ['fal-image'] as const
/** All known video providers: fal, or the Gemini API (google). */
export const VIDEO_PROVIDERS = ['fal', 'google'] as const

export type ImageProvider = (typeof IMAGE_PROVIDERS)[number]
export type StoryModeProvider = ImageProvider | VideoProvider
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number]

// ---------------------------------------------------------------------------
// Default configs per provider
// ---------------------------------------------------------------------------

const IMAGE_DEFAULT: CircuitBreakerConfig = {
  cooldownMs: 60_000,
  failureRateThreshold: 0.8,
  failureThreshold: 8,
  halfOpenMaxProbes: 1,
  minimumRequests: 20,
  // User-initiated retries are capped per shot upstream, so a same-code streak of
  // 10 inside one window spans many distinct requests and is systemic.
  rejectionStreakThreshold: 10,
  windowMs: 120_000,
}

const VIDEO_DEFAULT: CircuitBreakerConfig = {
  cooldownMs: 300_000,
  failureRateThreshold: 0.8,
  failureThreshold: 5,
  halfOpenMaxProbes: 1,
  minimumRequests: 10,
  rejectionStreakThreshold: 10,
  windowMs: 180_000,
}

const PROVIDER_DEFAULTS: Record<string, CircuitBreakerConfig> = {
  fal: VIDEO_DEFAULT,
  'fal-image': IMAGE_DEFAULT,
  google: VIDEO_DEFAULT,
}

/** Resolve the effective config for a provider: its hard-coded provider default. */
export function resolveProviderPolicy(provider: string): CircuitBreakerConfig {
  return PROVIDER_DEFAULTS[provider] ?? IMAGE_DEFAULT
}

import { type VoiceSpeed } from './voice-over'

export function formatVoiceSpeedLabel(speed: VoiceSpeed): string {
  return speed.charAt(0).toUpperCase() + speed.slice(1)
}

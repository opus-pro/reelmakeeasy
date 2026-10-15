'use client'

import type { DictationEngine, DictationSetting } from '@shared/types/api/setup'
import { cn } from '@shared/ui'

import { Spinner } from '@/components/agent/Spinner'

import { DICTATION_PRICE } from './dictation-text'
import { PriceTag } from './PriceTag'
import { useDictation } from './useDictation'

const ROWS: { blurb: string; id: DictationSetting; label: string }[] = [
  {
    blurb: 'Gemini, then Whisper on a fast computer, then fal, then your browser.',
    id: 'auto',
    label: 'Auto (best available)',
  },
  {
    blurb: 'Private, on this computer. About 1 GB of memory while loaded.',
    id: 'local',
    label: 'Whisper on this computer',
  },
  {
    blurb:
      'Words appear as you talk. Chrome sends the audio to Google; Safari keeps it on the device.',
    id: 'browser',
    label: 'Your browser',
  },
  {
    blurb: 'Gemini Transcribe: drops the "um"s, adds punctuation. About $0.005 a minute.',
    id: 'gemini',
    label: 'Gemini',
  },
  {
    blurb: 'ElevenLabs Scribe on fal, about $0.02 a minute.',
    id: 'fal',
    label: 'fal (ElevenLabs Scribe)',
  },
  { blurb: 'Hide the microphone in the chat boxes.', id: 'off', label: 'Off' },
]

const ENGINE_NAME: Record<DictationEngine, string> = {
  browser: 'your browser',
  fal: 'fal',
  gemini: 'Gemini',
  local: 'Whisper on this computer',
}

/** Setup's "Voice typing": which engine the 🎤 in the chat boxes uses. Saved at once. */
export function VoiceTypingCard({ className }: { className?: string }) {
  const { browserSupported, choose, engine, error, status } = useDictation({
    onText: () => undefined,
  })
  return (
    <section
      aria-labelledby="voice-typing-title"
      className={cn(
        'flex w-full flex-col gap-3 rounded-2xl border border-white/10 bg-menu-background p-5 text-left',
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-primary" id="voice-typing-title">
          Voice typing
        </h2>
        <p className="text-xs text-secondary">
          Click the microphone in a chat box and speak instead of typing.{' '}
          {status && (engine ? `Now using ${ENGINE_NAME[engine]}.` : 'Off or not available.')}
        </p>
      </div>
      {!status && <Spinner className="text-secondary" />}
      {status && (
        <div aria-label="Voice typing engine" className="flex flex-col gap-1.5" role="radiogroup">
          {ROWS.map((row) => {
            const option = status.options.find((o) => o.id === row.id)
            const browserMissing = row.id === 'browser' && !browserSupported
            const usable =
              row.id === 'auto' ||
              row.id === 'off' ||
              (option?.available === true && !browserMissing)
            const checked = status.setting === row.id
            const reason = browserMissing
              ? 'This browser has no speech recognition'
              : option && !option.available
                ? option.reason
                : undefined
            return (
              <button
                aria-checked={checked}
                className={cn(
                  'flex flex-col gap-0.5 rounded-lg border border-white/10 px-3 py-2.5 text-left transition-colors',
                  'disabled:cursor-not-allowed',
                  usable && 'hover:bg-white/5',
                  checked && 'border-white/30 bg-white/5',
                  !usable && 'opacity-50',
                )}
                disabled={!usable}
                key={row.id}
                onClick={() => void choose(row.id)}
                role="radio"
                type="button"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-primary">
                  {row.label}
                  {row.id !== 'auto' && row.id !== 'off' && (
                    <PriceTag price={DICTATION_PRICE[row.id]} />
                  )}
                </span>
                <span className="text-xs text-secondary">{row.blurb}</span>
                {reason && <span className="text-xs break-words text-secondary">{reason}</span>}
              </button>
            )
          })}
        </div>
      )}
      {error && <p className="text-xs text-accent-orange">{error}</p>}
    </section>
  )
}

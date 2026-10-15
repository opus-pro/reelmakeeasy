'use client'

import {
  type TtsEngine,
  type TtsEnginesResponse,
  type TtsEngineStatus,
} from '@shared/types/api/voice-over'
import { cn } from '@shared/ui/lib/utils'
import { useQuery } from '@tanstack/react-query'

import { useApi } from '@/hooks/useApi'

import { ENGINE_LABELS, engineCostLabel, engineCostTitle } from './tts-engine-copy'
import { type VoiceOption } from './voice-over-selection'

export type EngineFilter = 'all' | TtsEngine

// The free engines first, then the paid ones: Gemini just before ElevenLabs.
const ENGINE_ORDER: TtsEngine[] = ['kokoro', 'qwen3', 'gemini', 'elevenlabs']
/** Until the API answers, list the engines fal offers (Gemini's voices are always listed). */
const FALLBACK_SHOWN: TtsEngine[] = ['kokoro', 'qwen3', 'gemini', 'elevenlabs']

/** The filter chips: All, then the listed engines in display order. */
export function engineFilters(shown: TtsEngine[]): EngineFilter[] {
  return ['all', ...ENGINE_ORDER.filter((engine) => shown.includes(engine))]
}

/** The engines whose voices the picker lists now (Gemini always; picked only with its key). */
export function useShownEngines(): TtsEngine[] {
  return useTtsEnginesResponse()?.shown ?? FALLBACK_SHOWN
}

/** Until the API answers, assume the paid defaults rather than promising "free". */
const FALLBACK_STATUS: Record<TtsEngine, TtsEngineStatus> = {
  elevenlabs: { free: false, runsOn: 'elevenlabs' },
  gemini: { free: false, runsOn: 'google' },
  kokoro: { free: false, runsOn: 'fal' },
  qwen3: { free: false, runsOn: 'fal' },
}

/** Where each engine runs right now: free on this machine, or a paid API. */
export function useTtsEngines(): Record<TtsEngine, TtsEngineStatus> {
  return useTtsEnginesResponse()?.engines ?? FALLBACK_STATUS
}

/** GET /api/voice-over/engines: engines, the ElevenLabs key, Standard cloning. Undefined until it answers. */
export function useTtsEnginesResponse(): TtsEnginesResponse | undefined {
  const { fetchApiDomain } = useApi()
  const { data } = useQuery({
    queryFn: async () => {
      const res = await fetchApiDomain<TtsEnginesResponse>('/api/voice-over/engines')
      if (!res.ok) throw new Error(res.error || 'Failed to load voice engines')
      return res.data
    },
    queryKey: ['tts-engines'],
    staleTime: 30_000,
  })
  return data
}

/** The voices an engine filter keeps; the auto-select row always stays. */
export function filterVoicesByEngine(voices: VoiceOption[], filter: EngineFilter): VoiceOption[] {
  if (filter === 'all') return voices
  return voices.filter((v) => v.value === 'auto-select' || voiceEngine(v) === filter)
}

/** The engine a voice speaks with, or null for others (MiniMax clones on fal). */
export function voiceEngine(voice: Pick<VoiceOption, 'provider' | 'value'>): null | TtsEngine {
  if (voice.provider === 'gemini' || voice.value.startsWith('gemini-')) return 'gemini'
  if (voice.provider === 'kokoro' || voice.value.startsWith('kokoro-')) return 'kokoro'
  if (voice.provider === 'qwen3' || voice.value.startsWith('qwen3-')) return 'qwen3'
  if (!voice.provider || voice.provider === 'elevenlabs') return 'elevenlabs'
  return null
}

/** Filters the voice list by engine, and says which engines cost money. */
export function TtsEngineToggle({
  className,
  onChange,
  value,
}: {
  className?: string
  onChange: (value: EngineFilter) => void
  value: EngineFilter
}) {
  const engines = useTtsEngines()
  const shown = useShownEngines()
  return (
    <div
      aria-label="Voice engine"
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      role="radiogroup"
    >
      {engineFilters(shown).map((option) => {
        const selected = value === option
        const status = option === 'all' ? null : engines[option]
        return (
          <button
            aria-checked={selected}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
              selected
                ? 'border-white/60 bg-white/15 text-white'
                : 'border-white/10 text-white/60 hover:border-white/25 hover:text-white/80',
            )}
            key={option}
            onClick={() => onChange(option)}
            role="radio"
            title={
              option === 'all' ? undefined : engineCostTitle(option, status as TtsEngineStatus)
            }
            type="button"
          >
            {option === 'all' ? 'All' : ENGINE_LABELS[option]}
            {status && <CostTag status={status} />}
          </button>
        )
      })}
    </div>
  )
}

/** "Free" or "Paid" for one engine, as it runs right now (e.g. in a dialog header). */
export function EngineCostTag({ engine }: { engine: TtsEngine }) {
  const engines = useTtsEngines()
  return <CostTag status={engines[engine]} title={engineCostTitle(engine, engines[engine])} />
}

function CostTag({ status, title }: { status: TtsEngineStatus; title?: string }) {
  return (
    <span
      className={cn(
        'rounded px-1 py-px text-[10px] font-semibold uppercase leading-3 tracking-wide',
        status.free ? 'bg-[#A8E21F]/15 text-[#A8E21F]' : 'bg-white/10 text-white/70',
      )}
      title={title}
    >
      {engineCostLabel(status)}
    </span>
  )
}

/** "Free" on a voice row when its engine runs on this computer. */
export function VoiceCostBadge({ voice }: { voice: VoiceOption }) {
  const engines = useTtsEngines()
  const engine = voiceEngine(voice)
  if (!engine || !engines[engine].free) return null
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-3 tracking-wide bg-[#A8E21F]/15 text-[#A8E21F]"
      title={engineCostTitle(engine, engines[engine])}
    >
      Free
    </span>
  )
}

'use client'

import type { DictationEngine, DictationSetting } from '@shared/types/api/setup'
import { cn, DropdownMenu, Tooltip } from '@shared/ui'

import { Spinner } from '@/components/agent/Spinner'
import { ChevronDownSmall, Microphone, StopFilled } from '@/components/icons/core'

import { DICTATION_MENU_ORDER, DICTATION_PRICE, formatElapsed } from './dictation-text'
import { PriceTag } from './PriceTag'
import { SoundWave } from './SoundWave'
import type { Dictation } from './useDictation'

const ENGINE_HINT: Record<DictationEngine, string> = {
  browser: "Words appear as you talk. Uses your browser's speech recognition.",
  fal: 'ElevenLabs Scribe on fal, about $0.02 a minute.',
  gemini: 'Gemini Transcribe: drops the "um"s, adds punctuation. About $0.005 a minute.',
  local: 'Private, on this computer.',
}

const SETTING_LABEL: Record<DictationSetting, string> = {
  auto: 'Auto (best available)',
  browser: 'Your browser',
  fal: 'fal (ElevenLabs Scribe)',
  gemini: 'Gemini',
  local: 'Whisper on this computer',
  off: 'Off',
}

function tooltipFor(dictation: Dictation): string {
  if (dictation.phase === 'listening') return 'Stop and add the text (Esc cancels)'
  if (dictation.phase === 'transcribing') return 'Turning your words into text...'
  if (!dictation.engine) {
    return dictation.status?.setting === 'off'
      ? 'Voice typing is off: pick an engine'
      : 'Voice typing needs an engine: pick one'
  }
  if (!dictation.available) return "This browser can't record here: pick another engine"
  return `Speak instead of typing (${SETTING_LABEL[dictation.engine]})`
}

/**
 * The 🎤 next to a chat box: click to talk, click again to put the words in the box. The arrow
 * picks which engine turns speech into text.
 */
export function MicButton({
  className,
  dictation,
  disabled,
}: {
  className?: string
  dictation: Dictation
  disabled?: boolean
}) {
  const { available, browserSupported, elapsed, level, phase, status } = dictation
  const listening = phase === 'listening'
  const busy = phase === 'transcribing'
  const items = DICTATION_MENU_ORDER.map((setting) => {
    const option = status?.options.find((o) => o.id === setting)
    const browserMissing = setting === 'browser' && !browserSupported
    const usable = setting === 'auto' || setting === 'off' || (option?.available && !browserMissing)
    const reason = browserMissing
      ? 'This browser has no speech recognition'
      : option && !option.available
        ? option.reason
        : setting !== 'auto' && setting !== 'off'
          ? ENGINE_HINT[setting]
          : undefined
    return {
      checked: status?.setting === setting,
      className:
        'flex flex-col items-start gap-0.5 rounded-sm px-2.5 py-2 text-sm cursor-pointer data-[highlighted]:bg-fill-hover focus:bg-fill-hover data-[highlighted]:text-primary focus:text-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
      disabled: !usable,
      key: setting,
      label: (
        <span className="flex flex-col">
          <span className="flex items-center gap-2 font-medium text-primary">
            {SETTING_LABEL[setting]}
            {setting !== 'auto' && setting !== 'off' && (
              <PriceTag price={DICTATION_PRICE[setting]} />
            )}
          </span>
          {reason && <span className="text-xs text-secondary">{reason}</span>}
        </span>
      ),
      onClick: () => void dictation.choose(setting),
      type: 'item' as const,
    }
  })

  return (
    <div className={cn('flex shrink-0 items-center', className)}>
      <Tooltip content={tooltipFor(dictation)} side="top">
        <button
          aria-label={listening ? 'Stop voice typing' : 'Start voice typing'}
          aria-pressed={listening}
          className={cn(
            'relative flex h-11 items-center gap-1.5 rounded-l-lg border border-white/10 bg-fill-secondary px-3 text-primary transition-colors',
            'hover:bg-fill-hover disabled:cursor-not-allowed disabled:opacity-50',
            listening && 'border-red-400/60 bg-red-400/10',
          )}
          disabled={disabled || busy || !available}
          onClick={dictation.toggle}
          type="button"
        >
          {busy ? (
            <Spinner className="size-[18px] text-secondary" />
          ) : listening ? (
            <StopFilled className="relative size-[18px] text-red-400" />
          ) : (
            <Microphone className="size-[18px]" />
          )}
          {listening && <SoundWave level={level} />}
          {listening && (
            <span className="relative text-xs tabular-nums text-secondary">
              {formatElapsed(elapsed)}
            </span>
          )}
        </button>
      </Tooltip>
      <DropdownMenu
        align="end"
        classNames={{
          content:
            'bg-menu-background backdrop-blur-2xl w-72 rounded-2xl border border-white/10 p-1.5 text-primary',
        }}
        items={items}
        label="Voice typing"
        side="top"
      >
        <button
          aria-label="Choose how voice typing turns speech into text"
          className="flex h-11 items-center rounded-r-lg border border-l-0 border-white/10 bg-fill-secondary px-1.5 text-secondary hover:bg-fill-hover disabled:opacity-50"
          disabled={disabled || listening || busy}
          type="button"
        >
          <ChevronDownSmall className="size-4" />
        </button>
      </DropdownMenu>
    </div>
  )
}

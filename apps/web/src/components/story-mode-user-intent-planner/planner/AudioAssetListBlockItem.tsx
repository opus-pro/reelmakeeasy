'use client'

import { cn } from '@shared/ui'

import { Voiceover } from '@/components/icons/core'
import { PlaybackIconButton } from '@/components/shared/PlaybackIconButton'
import { resolvePlayableAudioUrl, useAudioPlayback } from '@/hooks/useAudioPlayback'

import { FONT_FEATURE_SETTINGS } from '../defaults'
import type { AudioAssetListBlock } from '../state-types'

interface AudioAssetCardProps {
  asset: AudioAssetListBlock['items'][number]
}

interface AudioAssetListBlockItemProps {
  block: AudioAssetListBlock
}

export function AudioAssetListBlockItem({ block }: AudioAssetListBlockItemProps) {
  // Cards hang off the user turn above, pulling out of the timeline's 24px gap to sit 8px
  // under the bubble. Scoped to a rendered bubble sibling: MessageBlockItem renders nothing
  // for an upload-only message, so with no bubble to hug the full gap stands.
  return (
    <div className="ml-auto flex max-w-[480px] flex-col items-end gap-2 [[data-role=user]+&]:-mt-4">
      {block.items.map((assetRef) => (
        <AudioAssetCard asset={assetRef} key={assetRef.id} />
      ))}
    </div>
  )
}

function AudioAssetCard({ asset }: AudioAssetCardProps) {
  const ext = getFileExtension(asset.label)
  const audioUrl = resolvePlayableAudioUrl([asset.previewUrl, asset.id])
  const { isPlaying, progress, togglePlayback } = useAudioPlayback(audioUrl)
  const canPlay = Boolean(audioUrl)
  const progressScale = Math.max(Math.min(1, Math.max(0, progress)), isPlaying ? 0.01 : 0)
  const progressTransform = `translateZ(0) scaleX(${progressScale})`

  return (
    <div className="group relative flex w-fit max-w-full items-center gap-2 overflow-hidden rounded-[12px] bg-[rgba(255,255,255,0.08)] px-3 py-2.5">
      {canPlay && progress > 0 ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-white/[0.14] will-change-transform"
          style={{
            backfaceVisibility: 'hidden',
            transform: progressTransform,
            transformOrigin: 'left center',
          }}
        />
      ) : null}

      <div className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-[8px] bg-[rgba(255,255,255,0.10)] p-1.5">
        <Voiceover
          className={cn(
            'size-[18px] text-white',
            canPlay && !isPlaying ? 'opacity-100 group-hover:opacity-0' : 'opacity-0',
          )}
        />
        {canPlay ? (
          <div
            className={cn(
              'absolute inset-0 flex items-center justify-center',
              isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            <PlaybackIconButton
              ariaLabel={isPlaying ? 'Pause audio' : 'Play audio'}
              className="size-6"
              iconClassName="!size-3 !text-white"
              isPlaying={isPlaying}
              onClick={() => togglePlayback()}
              style={{
                background:
                  'radial-gradient(90% 90% at 28% 24%, #d8f4ff 0%, #9cc5d8 56%, #789fb5 100%)',
              }}
            />
          </div>
        ) : null}
      </div>
      <div className="relative z-10 flex min-w-0 flex-1 flex-col items-start justify-center gap-1">
        <p
          className="w-full truncate whitespace-nowrap text-sm font-medium leading-[17px] text-white"
          style={FONT_FEATURE_SETTINGS}
        >
          {asset.label}
        </p>
        {ext && (
          <p
            className="whitespace-nowrap text-xs font-medium leading-[15px] text-white/50"
            style={FONT_FEATURE_SETTINGS}
          >
            {ext}
          </p>
        )}
      </div>
    </div>
  )
}

function getFileExtension(filename: string): string {
  const parts = filename.split('.')
  return parts.length > 1 ? (parts.pop()?.toUpperCase() ?? '') : ''
}

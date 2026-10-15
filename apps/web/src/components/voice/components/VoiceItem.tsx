import { Button, cn, Dialog } from '@shared/ui'
import React, { useState } from 'react'

import { Ai, FlagUnitedKingdom, FlagUnitedStates, Info, Warning } from '@/components/icons/core'
import { PlaybackIconButton } from '@/components/shared/PlaybackIconButton'
import { ResourceMenuAction, ResourceOptionsMenu } from '@/components/shared/ResourceOptionsMenu'
import { useBreakpoint } from '@/util/browserUtils'

import { ExpiredTooltip } from './ExpiredTooltip'
import { VoiceCostBadge } from './tts-engines'
import {
  getVoiceDescription,
  getVoiceRowClassName,
  getVoiceRowLabel,
  getVoiceSideLabel,
} from './voice-item-utils'
import { defaultColor, type VoiceOption } from './voice-over-selection'

// Accent to flag icon mapping
const ACCENT_FLAG_MAP: Record<string, React.FC<{ className?: string }>> = {
  'English (UK)': FlagUnitedKingdom,
  'English (US)': FlagUnitedStates,
}

interface VoiceItemProps {
  compact?: boolean
  disableHover?: boolean
  isDefault?: boolean
  isExpired?: boolean
  isLoading?: boolean
  isPlaying?: boolean
  isSelected?: boolean
  menuActions?: null | ResourceMenuAction[]
  menuClassName?: string
  menuOpen?: boolean
  onMenuOpenChange?: (open: boolean) => void
  onPlayback: (voice: VoiceOption) => void
  onSelect?: (voice: VoiceOption) => void
  /** The row can't be picked, but its stored preview still plays (a Gemini voice without its key). */
  previewWhenUnavailable?: boolean
  showLanguage?: boolean
  showToneLabel?: boolean
  /** Where the user fixes what `unavailableReason` says (the Setup page). */
  unavailableHref?: string
  /** Why the voice can't be used with the keys in .env; greys the row out. */
  unavailableReason?: string
  voice: VoiceOption
}

/** An expired voice stays silent; one that can't be picked plays only when its preview ships with the app. */
function canPlayPreview(
  isExpired: boolean | undefined,
  unavailableReason: string | undefined,
  previewWhenUnavailable: boolean,
): boolean {
  if (isExpired) return false
  return !unavailableReason || previewWhenUnavailable
}

function getAccentFlag(accent: string): React.FC<{ className?: string }> {
  return ACCENT_FLAG_MAP[accent] ?? FlagUnitedStates
}

function getMobileVoiceDescription(
  voice: VoiceOption,
  isAutoSelect: boolean,
  showLanguage: boolean,
): string {
  if (showLanguage && !isAutoSelect) {
    const [language, gender] = voice.labels ?? []
    const compactDescription = [gender, language].filter(Boolean).join(' · ')
    if (compactDescription) {
      return compactDescription
    }
  }

  return getVoiceDescription(voice, isAutoSelect)
}

function getMobileVoiceInfoDescription(voice: VoiceOption, isAutoSelect: boolean): string {
  if (!isAutoSelect) {
    const [language, gender, ...details] = voice.labels ?? []
    const compactDescription = [gender, ...details, language].filter(Boolean).join(' · ')
    if (compactDescription) {
      return compactDescription
    }
  }

  return getVoiceDescription(voice, isAutoSelect)
}

/**
 * Why the row can't be picked, linked to where it is fixed. The link opens Setup in a new tab, so
 * this page stays as it is: the voice library open over an unsent chat or brief, which leaving
 * the page (by a reload or in the app) would lose.
 */
function unavailableLabel(reason?: string, href?: string): React.ReactNode {
  if (!reason || !href) return reason
  return (
    <a
      className="underline underline-offset-2 hover:text-primary"
      href={href}
      onClick={(e) => e.stopPropagation()}
      rel="noopener noreferrer"
      target="_blank"
    >
      {reason}
    </a>
  )
}

export const VoiceItem: React.FC<VoiceItemProps> = ({
  compact = false,
  disableHover = false,
  voice,
  isSelected,
  isPlaying,
  isLoading,
  isExpired,
  isDefault = false,
  onSelect,
  onPlayback,
  menuActions,
  menuClassName,
  menuOpen,
  onMenuOpenChange,
  showLanguage = false,
  previewWhenUnavailable = false,
  showToneLabel = false,
  unavailableReason,
  unavailableHref,
}) => {
  const isAutoSelect = voice.value === 'auto-select'
  const [isMenuHovered, setIsMenuHovered] = useState(false)
  const [isMobileInfoOpen, setIsMobileInfoOpen] = useState(false)
  const { isBelowMd } = useBreakpoint('md')
  const isInactive = isExpired || Boolean(unavailableReason)
  const canPreview = canPlayPreview(isExpired, unavailableReason, previewWhenUnavailable)
  const showHover = !isInactive && !disableHover
  const sideLabel = getVoiceSideLabel(voice, isAutoSelect)
  const reasonLabel = unavailableLabel(unavailableReason, unavailableHref)
  const desktopLabel = reasonLabel ?? getVoiceRowLabel(voice, isAutoSelect, showToneLabel)
  const mobileLabel =
    reasonLabel ??
    (showToneLabel ? sideLabel : getMobileVoiceDescription(voice, isAutoSelect, showLanguage))
  const mobileInfoDescription = getMobileVoiceInfoDescription(voice, isAutoSelect)

  const hasMobileMenu = !!(menuActions && menuActions.length > 0)

  const handleSelect = () => {
    if (isInactive) {
      return
    }
    onSelect?.(voice)
  }

  return (
    <>
      <div
        className={getVoiceRowClassName({
          isInactive,
          isMenuHovered,
          isSelected,
          showHover,
        })}
        onClick={handleSelect}
        title={unavailableReason}
      >
        {/* Left Side - Play Button/AI Icon and Voice Info */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* Play/Pause Button or AI Icon for Auto-select */}
          {isAutoSelect ? (
            <div
              className="rounded-full shrink-0 size-8 relative overflow-hidden flex items-center justify-center"
              style={{ background: voice.color || defaultColor }}
            >
              <Ai className="size-4.5 text-white" />
            </div>
          ) : (
            <PlaybackIconButton
              ariaLabel={isPlaying ? 'Pause voice preview' : 'Play voice preview'}
              disabled={isLoading || !canPreview}
              isPlaying={isPlaying}
              onClick={(e) => {
                e.stopPropagation()
                if (canPreview) {
                  onPlayback(voice)
                }
              }}
              style={{ background: voice.color || defaultColor }}
            />
          )}

          {/* Voice Info */}
          <div className="flex h-[39px] min-w-0 flex-1 flex-col items-start justify-center gap-0.5">
            <div className="flex flex-row gap-1 items-center justify-start self-stretch">
              <div
                className={cn(
                  'min-w-0 truncate text-left text-base font-medium leading-normal md:text-sm',
                  isInactive ? 'text-primary/25' : 'text-primary',
                )}
              >
                {voice.name}
              </div>

              {isDefault && (
                <div className="bg-tertiary rounded-xxs px-1.5 flex flex-row gap-2.5 items-center justify-center shrink-0 h-5 relative">
                  <div className="text-primary text-left text-xs font-medium leading-[15px] relative">
                    Default
                  </div>
                </div>
              )}
            </div>

            <div
              className={cn('flex flex-row gap-0.5 items-start justify-start', compact && 'hidden')}
            >
              <div
                className={cn(
                  'text-left text-sm leading-normal md:hidden',
                  isInactive ? 'text-primary/25' : 'text-secondary',
                )}
              >
                {mobileLabel}
              </div>
              <div
                className={cn(
                  'hidden text-left text-xs leading-normal md:block',
                  isInactive ? 'text-primary/25' : 'text-secondary',
                  showToneLabel && !showLanguage && 'md:hidden',
                )}
              >
                {desktopLabel}
              </div>
            </div>
          </div>
        </div>

        {/* Right Side - Language and Menu */}
        <div className="flex flex-row gap-3 items-center justify-end shrink-0">
          {/* Mobile: ellipsis menu for custom voices, info icon for library voices.
              Hidden in compact mode (the UIP mobile voiceover sheet shows tone only). */}
          <div
            className={cn('md:hidden', compact && 'hidden')}
            onClick={(e) => e.stopPropagation()}
          >
            {hasMobileMenu ? (
              <div
                onMouseEnter={() => setIsMenuHovered(true)}
                onMouseLeave={() => setIsMenuHovered(false)}
              >
                <ResourceOptionsMenu
                  actions={menuActions ?? []}
                  buttonClassName="flex items-center justify-center size-8 text-white/50"
                  menuClassName={menuClassName}
                />
              </div>
            ) : (
              <Info
                className={cn('size-4.5 shrink-0', isInactive ? 'text-white/25' : 'text-white/50')}
                onClick={() => !isInactive && setIsMobileInfoOpen(true)}
                role="button"
              />
            )}
          </div>

          <div
            className={cn(
              'flex-row items-center justify-end gap-3',
              compact ? 'flex' : 'hidden md:flex',
            )}
          >
            {showToneLabel && !showLanguage && sideLabel && (
              <span className="text-secondary text-sm leading-normal whitespace-nowrap md:text-xs">
                {sideLabel}
              </span>
            )}
            {showLanguage &&
              !isInactive &&
              !isAutoSelect &&
              voice.labels?.[0] &&
              (() => {
                const FlagIcon = getAccentFlag(voice.labels[0])
                return (
                  <div className="flex flex-row gap-1 items-center justify-center">
                    <FlagIcon className="size-4 shrink-0" />
                    <div className="text-text-secondary text-left text-xs leading-normal whitespace-nowrap">
                      {voice.labels[0]}
                    </div>
                  </div>
                )
              })()}

            {!isInactive && !isAutoSelect && <VoiceCostBadge voice={voice} />}

            {isExpired && (
              <ExpiredTooltip>
                <div className="flex items-center justify-center gap-1 h-[23px] px-1.5 py-1 rounded-md cursor-help bg-white/10 backdrop-blur-2xl">
                  <Warning className="size-3.5 shrink-0 text-text-primary" />
                  <div className="text-text-primary text-xs font-medium leading-normal">
                    Expired
                  </div>
                </div>
              </ExpiredTooltip>
            )}

            {menuActions && !isBelowMd && (
              <div
                onClick={(e) => e.stopPropagation()}
                onMouseEnter={() => setIsMenuHovered(true)}
                onMouseLeave={() => setIsMenuHovered(false)}
              >
                <ResourceOptionsMenu
                  actions={menuActions}
                  buttonClassName={cn(
                    'flex items-center justify-center gap-1 h-8 min-w-8 px-2 rounded-sm bg-ui-button-hover transition-colors',
                    !disableHover && 'hover:bg-fill-hover',
                  )}
                  menuClassName={menuClassName}
                  onOpenChange={onMenuOpenChange}
                  open={menuOpen}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog
        classNames={{
          content:
            'w-[300px] max-w-[calc(100vw-32px)] gap-0 rounded-3xl border-0 bg-menu-background p-4 text-white shadow-none backdrop-blur-2xl z-[96]',
          overlay: 'bg-black/70 z-[95] pointer-events-auto',
        }}
        footer={null}
        header={null}
        onOpenChange={setIsMobileInfoOpen}
        open={isMobileInfoOpen}
        showClose={false}
        title={`${voice.name} voice details`}
      >
        <div className="flex flex-col gap-6" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              {isAutoSelect ? (
                <div
                  className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full"
                  style={{ background: voice.color || defaultColor }}
                >
                  <Ai className="size-5 text-white" />
                </div>
              ) : (
                <PlaybackIconButton
                  ariaLabel={isPlaying ? 'Pause voice preview' : 'Play voice preview'}
                  disabled={isLoading || !canPreview}
                  isPlaying={isPlaying}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (canPreview) {
                      onPlayback(voice)
                    }
                  }}
                  style={{ background: voice.color || defaultColor }}
                />
              )}
              <h3 className="min-w-0 truncate text-[18px] font-semibold leading-[22px] text-white">
                {voice.name}
              </h3>
            </div>
            <p className="text-[16px] font-normal leading-[26px] text-white/50">
              {mobileInfoDescription}
            </p>
          </div>

          <Button
            className="h-12 w-full rounded-full bg-white/10 text-sm font-medium text-white md:hover:bg-white/[0.14]"
            onClick={(e) => {
              e.stopPropagation()
              setIsMobileInfoOpen(false)
            }}
          >
            Okay
          </Button>
        </div>
      </Dialog>
    </>
  )
}

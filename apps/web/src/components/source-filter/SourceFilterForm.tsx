'use client'

import { Button, cn, RadioGroup, RadioGroupItem, Separator, Switch, Tooltip } from '@shared/ui'
import React from 'react'

import { Delete, Info, PlusSmall, WebAssetOff, YoutubeColored } from '@/components/icons/core'

export interface SourceFilterFormProps {
  blockedSites: string[]
  onAddSite: () => void
  onBlockedSiteChange: (index: number, value: string) => void
  onRemoveSite: (index: number) => void
  onYoutubeContentTypeChange: (type: 'all' | 'creativeCommonsOnly') => void
  onYoutubeEnabledChange: (enabled: boolean) => void
  /** UI variant: 'dialog' for modal dialog, 'drawer' for settings drawer */
  variant?: 'dialog' | 'drawer'
  youtubeContentType: 'all' | 'creativeCommonsOnly'
  youtubeEnabled: boolean
}

const radioItemClassName =
  "size-4 shrink-0 border-2 border-white text-white relative [&>span]:hidden data-[state=checked]:after:content-[''] data-[state=checked]:after:absolute data-[state=checked]:after:top-1/2 data-[state=checked]:after:left-1/2 data-[state=checked]:after:-translate-x-1/2 data-[state=checked]:after:-translate-y-1/2 data-[state=checked]:after:size-1.5 data-[state=checked]:after:rounded-full data-[state=checked]:after:bg-white"

interface RadioOptionItemProps {
  description?: string
  label: string
  tooltip?: string
  value: string
  variant: 'dialog' | 'drawer'
}

/** Unified radio option item: label on left, radio on right */
const RadioOptionItem: React.FC<RadioOptionItemProps> = ({
  description,
  label,
  tooltip,
  value,
  variant,
}) => {
  const isDrawer = variant === 'drawer'

  return (
    <label className="flex items-center justify-between py-2 cursor-pointer">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <span
            className={cn(
              'font-medium',
              isDrawer ? 'text-base text-primary' : 'text-[14px] text-white',
            )}
          >
            {label}
          </span>
          {tooltip && (
            <Tooltip
              className="!bg-menu !text-white !text-sm !font-normal !leading-relaxed !font-sans !border-0 !rounded-lg !px-4 !py-3 !max-w-[350px] !shadow-xl"
              content={tooltip}
              side="top"
            >
              <Info className={cn('size-4 cursor-pointer', 'text-secondary')} />
            </Tooltip>
          )}
        </div>
        {description && <div className="text-[12px] text-secondary">{description}</div>}
      </div>
      <RadioGroupItem className={radioItemClassName} value={value} />
    </label>
  )
}

/**
 * Pure UI component for source filter settings form.
 * Renders YouTube source toggle, content type selection, and blocked sites management.
 */
export const SourceFilterForm: React.FC<SourceFilterFormProps> = ({
  youtubeEnabled,
  onYoutubeEnabledChange,
  youtubeContentType,
  onYoutubeContentTypeChange,
  blockedSites,
  onBlockedSiteChange,
  onAddSite,
  onRemoveSite,
  variant = 'dialog',
}) => {
  const isDrawer = variant === 'drawer'

  const renderRadioOptions = () => (
    <>
      <RadioOptionItem
        description={
          isDrawer ? undefined : 'Use sources from all YouTube videos, except blocked channels.'
        }
        label="Allow all YouTube videos"
        value="all"
        variant={variant}
      />
      <RadioOptionItem
        description={
          isDrawer ? undefined : 'Use sources only from Creative Commons videos on YouTube.'
        }
        label="Only Creative Commons videos"
        tooltip="Creative Commons is a global nonprofit organization that give creators a standardized way to grant someone else permission to use their work."
        value="creativeCommonsOnly"
        variant={variant}
      />
    </>
  )

  const renderYoutubeToggle = () => {
    if (isDrawer) {
      return (
        <Switch
          checked={youtubeEnabled}
          className="data-[state=checked]:bg-white data-[state=unchecked]:bg-white/30"
          onCheckedChange={onYoutubeEnabledChange}
        />
      )
    }
    return (
      <Tooltip
        className="!bg-menu !text-white !text-sm !font-normal !leading-relaxed !font-sans !border-0 !rounded-lg !px-4 !py-3 !max-w-[350px] !shadow-xl"
        content={
          youtubeEnabled
            ? 'Block all YouTube videos for AI use'
            : 'Allow all YouTube videos for AI use'
        }
        delayDuration={300}
        side="top"
      >
        <span className="inline-flex">
          <Switch
            checked={youtubeEnabled}
            className="data-[state=checked]:bg-white data-[state=unchecked]:bg-[rgba(255,255,255,0.3)]"
            onCheckedChange={onYoutubeEnabledChange}
          />
        </span>
      </Tooltip>
    )
  }

  const renderDialogAddSiteButton = () => {
    if (blockedSites.length >= 5) {
      return (
        <Tooltip
          className="!bg-menu !text-white !text-sm !font-normal !leading-relaxed !font-sans !border-0 !rounded-lg !px-4 !py-3 !max-w-[350px] !shadow-xl"
          content="You can add up to 5 sites"
          side="top"
        >
          <span className="inline-block cursor-pointer">
            <Button
              className="bg-[rgba(255,255,255,0.1)] gap-1 px-2 h-8 min-w-[32px] text-white disabled:bg-[rgba(255,255,255,0.1)] disabled:hover:bg-[rgba(255,255,255,0.1)] disabled:!cursor-pointer rounded-sm"
              disabled={true}
              onClick={onAddSite}
              size="sm"
              variant="ghost"
            >
              <PlusSmall className="size-4 opacity-25" />
              <span className="text-[14px] font-medium leading-[17px] opacity-25">Add site</span>
            </Button>
          </span>
        </Tooltip>
      )
    }
    return (
      <Button
        className="bg-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.15)] hover:text-white gap-1 px-2 h-8 min-w-[32px] text-white cursor-pointer rounded-sm"
        disabled={false}
        onClick={onAddSite}
        size="sm"
        variant="ghost"
      >
        <PlusSmall className="size-4" />
        <span className="text-[14px] font-medium leading-[17px] hover:text-white">Add site</span>
      </Button>
    )
  }

  const renderBlockedSiteInputs = () => (
    <div className="flex flex-col gap-2">
      {blockedSites.map((site, index) => (
        <div className="flex items-center gap-1" key={index}>
          <input
            className={cn(
              'flex-1 rounded-sm border px-4 h-[38px] text-white focus:outline-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring',
              isDrawer
                ? 'bg-black/15 border-white/10 text-sm placeholder:text-white/25 focus:border-white/50'
                : 'bg-[rgba(0,0,0,0.15)] border-[rgba(255,255,255,0.1)] text-[14px] placeholder:text-[rgba(255,255,255,0.25)] focus:border-[rgba(255,255,255,0.5)]',
            )}
            onChange={(e) => onBlockedSiteChange(index, e.target.value)}
            placeholder="e.g. domain.com"
            type="text"
            value={site}
          />
          <button
            className={cn(
              'rounded-full size-8 flex items-center justify-center transition-colors',
              isDrawer ? 'hover:bg-white/10' : 'hover:bg-[rgba(255,255,255,0.1)]',
            )}
            onClick={() => onRemoveSite(index)}
            type="button"
          >
            <Delete
              className={cn(
                'hover:text-white',
                isDrawer ? 'size-4.5 text-secondary' : 'size-[18px] text-secondary',
              )}
            />
          </button>
        </div>
      ))}
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {/* YouTube sources section */}
      <div className={cn('flex flex-col gap-4', isDrawer && 'bg-white/5 rounded-sm p-5')}>
        {/* YouTube header with toggle */}
        <div className="flex items-center justify-between gap-3">
          <div className={cn('flex items-center flex-1', isDrawer ? 'gap-2' : 'gap-3')}>
            <div
              className={cn(
                'size-10 rounded-xs flex items-center justify-center shrink-0',
                isDrawer ? 'bg-white/10' : 'bg-[rgba(255,255,255,0.1)]',
              )}
            >
              <YoutubeColored className="size-6" />
            </div>
            <div className="flex flex-col gap-0.5">
              <h3
                className={cn(
                  'font-medium text-white',
                  isDrawer ? 'text-base text-primary' : 'text-[14px]',
                )}
              >
                YouTube sources
              </h3>
              <p className={cn(isDrawer ? 'text-sm text-secondary' : 'text-[12px] text-secondary')}>
                Using sources from YouTube
              </p>
            </div>
          </div>
          {renderYoutubeToggle()}
        </div>

        {/* Radio options - only visible when YouTube is enabled */}
        {youtubeEnabled && (
          <RadioGroup
            className="flex flex-col gap-0"
            onValueChange={(value) =>
              onYoutubeContentTypeChange(value as 'all' | 'creativeCommonsOnly')
            }
            value={youtubeContentType}
          >
            {renderRadioOptions()}
          </RadioGroup>
        )}
      </div>

      {!isDrawer && <Separator className="bg-[rgba(255,255,255,0.1)]" />}

      {/* Block specific sites section */}
      <div className={cn('flex flex-col gap-4', isDrawer && 'bg-white/5 rounded-sm p-5')}>
        <div className={cn('flex items-center gap-3', isDrawer ? 'gap-2' : 'justify-between')}>
          <div className={cn('flex items-center flex-1', isDrawer ? 'gap-2' : 'gap-3')}>
            <div
              className={cn(
                'size-10 rounded-xs flex items-center justify-center shrink-0',
                isDrawer ? 'bg-white/10' : 'bg-[rgba(255,255,255,0.1)]',
              )}
            >
              <WebAssetOff className={cn('size-6', isDrawer && 'text-primary')} />
            </div>
            <div className={cn('flex flex-col gap-0.5', isDrawer && 'flex-1')}>
              <div className="flex items-center gap-1">
                <h3
                  className={cn(
                    'font-medium text-white',
                    isDrawer ? 'text-base text-primary' : 'text-sm',
                  )}
                >
                  Block sources from specific sites
                </h3>
                <Tooltip
                  align="start"
                  alignOffset={-20}
                  arrow={!isDrawer}
                  className={cn(
                    '!bg-menu !text-white !text-sm !font-normal !leading-relaxed !font-sans !border-0 !rounded-lg !px-4 !py-3 !shadow-xl',
                    isDrawer ? '!max-w-[300px]' : '!max-w-[350px]',
                  )}
                  content={
                    isDrawer
                      ? "Add YouTube channels or websites you don't want AI to use."
                      : "Add YouTube channels or websites you don't want AI to use (e.g., youtube.com/@channel or example.com)."
                  }
                  side="top"
                >
                  <Info className={cn('size-4 cursor-pointer shrink-0', 'text-secondary')} />
                </Tooltip>
              </div>
              <p className={cn(isDrawer ? 'text-sm text-secondary' : 'text-[12px] text-secondary')}>
                {isDrawer
                  ? 'Sites or channels to block from AI use (Max 5).'
                  : 'Add sites or channel links to block from AI use (Max 5).'}
              </p>
            </div>
          </div>

          {/* Add site button - only in dialog variant, in header */}
          {!isDrawer && renderDialogAddSiteButton()}
        </div>

        {/* Dynamic input fields */}
        {(isDrawer ? blockedSites.length > 0 : true) && renderBlockedSiteInputs()}

        {/* Add site button - only in drawer variant, full width at bottom */}
        {isDrawer && (
          <Button
            className="w-full bg-white/10 hover:bg-white/15 text-white h-8 rounded-sm"
            disabled={blockedSites.length >= 5}
            onClick={onAddSite}
            size="sm"
            variant="ghost"
          >
            <PlusSmall className="size-4" />
            <span className="text-sm font-medium">Add site</span>
          </Button>
        )}
      </div>
    </div>
  )
}

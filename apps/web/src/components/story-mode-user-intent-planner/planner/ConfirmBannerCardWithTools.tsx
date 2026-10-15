'use client'

import type { ReactNode } from 'react'

import { useIsMobile } from '@/util/browserUtils'

import { FONT_FEATURE_SETTINGS } from '../defaults'

import { GlowBorderFrame } from './GlowBorderFrame'

interface ConfirmBannerCardWithToolsProps {
  countdown?: ReactNode
  dataTestId?: string
  hideGlowBorder?: boolean
  icon?: ReactNode
  left?: ReactNode
  right: ReactNode
  title: ReactNode
}

export function ConfirmBannerCardWithTools({
  countdown,
  dataTestId,
  hideGlowBorder = false,
  icon,
  left,
  right,
  title,
}: ConfirmBannerCardWithToolsProps) {
  const isMobile = useIsMobile()

  return (
    <GlowBorderFrame
      className="animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
      data-testid={dataTestId ?? 'uip-confirm-banner-card-tools'}
      glowRingBase="transparent"
      hideGlowBorder={hideGlowBorder}
    >
      {/* Row 1: icon + title (+ countdown on desktop) */}
      <div
        className={
          isMobile
            ? 'flex items-center gap-3 px-2 py-1'
            : 'flex h-[46px] items-center gap-3 px-2 py-1'
        }
      >
        {icon ? <div className="shrink-0">{icon}</div> : null}
        <p
          className="min-w-0 flex-1 text-base font-medium leading-[20px] text-white"
          style={FONT_FEATURE_SETTINGS}
        >
          {title}
        </p>
        {!isMobile && countdown ? (
          <div
            className="shrink-0 text-sm font-normal leading-[22px] text-white/50"
            style={FONT_FEATURE_SETTINGS}
          >
            {countdown}
          </div>
        ) : null}
      </div>

      {/* Row 2: desktop = row layout, mobile = full-width stacked layout */}
      <div
        className={isMobile ? 'flex flex-col gap-3 p-2' : 'flex items-center justify-between p-2'}
      >
        {isMobile ? (
          <>
            {left ? <div className="w-full">{left}</div> : null}
            <div className="flex w-full flex-col gap-3">{right}</div>
            {countdown ? (
              <div
                className="text-center text-sm font-normal leading-[22px] text-white/50"
                style={FONT_FEATURE_SETTINGS}
              >
                {countdown}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-2">{left ?? <div />}</div>
            <div className="flex shrink-0 items-center gap-2">{right}</div>
          </>
        )}
      </div>
    </GlowBorderFrame>
  )
}

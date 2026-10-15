'use client'

import type { ReactNode } from 'react'

import { FONT_FEATURE_SETTINGS } from '../defaults'

import { GlowBorderFrame } from './GlowBorderFrame'

interface ConfirmBannerCardProps {
  dataTestId?: string
  description?: ReactNode
  hideGlowBorder?: boolean
  icon?: ReactNode
  right: ReactNode
  title: ReactNode
}

export function ConfirmBannerCard({
  dataTestId,
  description,
  hideGlowBorder = false,
  icon,
  right,
  title,
}: ConfirmBannerCardProps) {
  return (
    <GlowBorderFrame
      className="animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
      data-testid={dataTestId ?? 'uip-confirm-banner-card'}
      glowRingBase="transparent"
      hideGlowBorder={hideGlowBorder}
    >
      <div className="flex min-h-[58px] items-center gap-3 p-2">
        {icon ? <div className="shrink-0">{icon}</div> : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <p
            className="text-base font-medium leading-[20px] text-white"
            style={FONT_FEATURE_SETTINGS}
          >
            {title}
          </p>
          {description ? (
            <div
              className="text-sm font-normal leading-[22px] text-white/50"
              style={FONT_FEATURE_SETTINGS}
            >
              {description}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">{right}</div>
      </div>
    </GlowBorderFrame>
  )
}

import { LongTakeStatusStage, LongTakeStatusState } from '@shared/types/api/long-take'
import { memo } from 'react'

import { ProjectBgParams } from '@/app/projects/[projectId]/constants/shader-gradient'
import LottieCanvas from '@/components/animated/LottieCanvas'
import ShaderGradientBackground from '@/components/animated/ShaderGradientBackground'
import { Info } from '@/components/icons/core'

import {
  getConcurrentStageLabels,
  getStageHeadline,
  getStageLabel,
  getStageProgressPercent,
  getStageSecondaryText,
  isFailedStage,
} from '../progress'

interface ProcessingPreviewProps {
  aspectRatio: string
  concurrentStages?: LongTakeStatusStage[]
  headlineOverride?: string
  labelOverride?: string
  stage?: LongTakeStatusStage
  stageDetail?: string
  status?: LongTakeStatusState
}

const ProcessingPreview: React.FC<ProcessingPreviewProps> = ({
  aspectRatio,
  concurrentStages,
  headlineOverride,
  labelOverride,
  stage,
  stageDetail,
  status,
}) => {
  const stageLabel = labelOverride ?? getStageLabel(stage)
  const stageHeadline = headlineOverride ?? getStageHeadline(stage)
  const progressPercent = getStageProgressPercent(stage, status)
  const secondaryText = getStageSecondaryText(stage, stageDetail)
  const stageLabels = getConcurrentStageLabels(stage, concurrentStages, status)
  const hasMultipleStages = !labelOverride && stageLabels.length > 1

  return (
    <div
      className="relative z-0 flex size-full flex-col items-center justify-center gap-y-2 overflow-hidden rounded-2xl text-center"
      style={{ aspectRatio }}
    >
      <div className="relative z-10 flex size-full flex-1 flex-col items-center justify-center gap-y-4 bg-transparent p-8">
        {isFailedStage(stage) ? (
          <>
            <Info className="size-6 text-primary" />
            <div className="w-full break-words text-sm font-medium text-primary">
              {stageHeadline}
            </div>
            <div className="text-xs text-secondary">{secondaryText}</div>
          </>
        ) : (
          <>
            <LottieCanvas size={36} type="hourglass" />
            <div className="w-full break-words text-sm font-medium text-primary">
              {stageHeadline}
            </div>
            <div className="text-xs text-secondary">{secondaryText}</div>
            {hasMultipleStages ? (
              <div className="flex flex-wrap justify-center gap-2">
                {stageLabels.map((label) => (
                  <span
                    className="rounded-full border border-white/15 px-2.5 py-0.5 text-xs font-medium text-secondary"
                    key={label}
                  >
                    {label}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-2 w-full max-w-[260px]">
                <div className="mb-2 flex items-center justify-between text-sm uppercase tracking-[0.2em] text-secondary">
                  <span>{stageLabel}</span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-white/25">
                  <div
                    className="h-1.5 rounded-full bg-emerald-300 transition-[width] duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <ShaderGradientBackground
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-2xl opacity-100"
        gradientProps={ProjectBgParams}
      />
    </div>
  )
}

export default memo(ProcessingPreview)

import { cn } from '@shared/ui'
import { memo } from 'react'

import LottieCanvas from '@/components/animated/LottieCanvas'
import ShaderGradientBackground from '@/components/animated/ShaderGradientBackground'

import { ProjectBgParams } from '../../constants/shader-gradient'

type EditorEngineLoadingProps = {
  className?: string
  description?: string
  lottieType?: string
  showBackground?: boolean
  title?: string
  variant?: EditorEngineLoadingVariant
}

type EditorEngineLoadingVariant = 'editor' | 'video'

const COPY_BY_VARIANT: Record<EditorEngineLoadingVariant, { description: string; title: string }> =
  {
    editor: {
      title: 'Warming up the editor',
      description: 'Rendering the first frame so you can start editing.',
    },
    video: {
      title: 'Generating video...',
      description: 'The video will be ready in a few minutes.',
    },
  }

const EditorEngineLoading = ({
  className,
  description,
  lottieType = 'hourglass',
  showBackground = true,
  title,
  variant = 'editor',
}: EditorEngineLoadingProps) => {
  const copy = COPY_BY_VARIANT[variant]
  const resolvedTitle = title ?? copy.title
  const resolvedDescription = description ?? copy.description

  return (
    <div
      className={cn(
        'relative aspect-[9/16] flex flex-col items-center justify-center gap-y-2 overflow-hidden rounded-xl px-8 py-8 text-center',
        className,
      )}
    >
      <div className="relative z-10 flex size-full flex-1 flex-col items-center justify-center gap-y-2 bg-transparent">
        <LottieCanvas size={20} type={lottieType} />
        <div className={cn('w-full break-words text-center font-medium text-sm text-primary')}>
          {resolvedTitle}
        </div>
        {resolvedDescription && (
          <p className={cn('text-center text-xs text-secondary')}>{resolvedDescription}</p>
        )}
      </div>
      {showBackground && (
        <ShaderGradientBackground
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-xl opacity-100"
          gradientProps={ProjectBgParams}
        />
      )}
    </div>
  )
}

export default memo(EditorEngineLoading)

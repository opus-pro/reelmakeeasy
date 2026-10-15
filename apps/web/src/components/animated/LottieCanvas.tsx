import { cn } from '@shared/ui'
import { useQuery } from '@tanstack/react-query'
import Lottie from 'lottie-react'
import { memo, useMemo } from 'react'

import { getPublicCdnUrl } from '@/util/cdn-utils'

interface LottieCanvasProps {
  className?: string
  description?: string
  size?: number
  type?: string
}

const LottieCanvas: React.FC<LottieCanvasProps> = ({
  description,
  type = 'script',
  size = 200,
  className,
}) => {
  const scriptLottieUrl = useMemo(() => {
    return getPublicCdnUrl(`agent/lottie/lottie_${type}.json`)
  }, [type])

  const { data: animationData, error } = useQuery({
    queryKey: ['lottie', type],
    queryFn: async () => {
      const response = await fetch(scriptLottieUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch animation: ${response.status}`)
      }
      return response.json()
    },
    enabled: !!scriptLottieUrl,
    staleTime: Infinity, // Cache forever since lottie files don't change
    gcTime: Infinity, // Keep in cache forever
  })

  return (
    <div className={cn('flex flex-col items-center justify-center', className)}>
      {error && <div className="text-error">Failed to load animation</div>}
      {animationData && (
        <Lottie animationData={animationData} loop={true} style={{ width: size, height: size }} />
      )}
      {description && <div className="text-tertiary mt-5 text-base font-medium">{description}</div>}
    </div>
  )
}

export default memo(LottieCanvas)

LottieCanvas.displayName = 'LottieCanvas'

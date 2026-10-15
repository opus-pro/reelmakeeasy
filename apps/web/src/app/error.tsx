'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { reloadOnChunkError } from './chunk-reload'

const nsLogger = Logger.get('error')

interface ErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const router = useRouter()
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    if (reloadOnChunkError(error)) {
      setReloading(true)
      return
    }
    // Log error to analytics/monitoring service
    nsLogger.error('Error boundary triggered:', error)
  }, [error])

  const handleGoHome = () => {
    router.push('/')
  }

  const handleRetry = () => {
    reset()
  }

  const errorMessage = error?.message || 'An unexpected error occurred'
  const errorDigest = error?.digest

  if (reloading) {
    return null
  }

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        {/* Error Title */}
        <h1 className="text-primary mb-4 text-2xl font-bold">Oops! Something went wrong</h1>

        {/* Error Message */}
        <p className="text-secondary mb-6 leading-relaxed">{errorMessage}</p>

        {/* Error Digest (for debugging) */}
        {errorDigest && (
          <div className="bg-fill-tertiary mb-6 rounded-lg p-3">
            <p className="text-tertiary font-mono text-xs">Error ID: {errorDigest}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col gap-3">
          <button onClick={handleRetry}>Try Again</button>

          <button onClick={handleGoHome}>Go Home</button>
        </div>
      </div>
    </div>
  )
}

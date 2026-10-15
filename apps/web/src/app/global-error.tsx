'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'
import { useEffect, useState } from 'react'

import { reloadOnChunkError } from './chunk-reload'

import './styles/tailwind.css'

const nsLogger = Logger.get('error')

interface ErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function GlobalErrorPage({ error, reset }: ErrorPageProps) {
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    if (reloadOnChunkError(error)) {
      setReloading(true)
      return
    }
    nsLogger.error('Error boundary triggered:', error)
  }, [error])

  const handleGoHome = () => {
    window.location.href = '/'
  }

  const handleRetry = () => {
    reset()
  }

  const errorMessage = error?.message || 'An unexpected error occurred'
  const errorDigest = error?.digest

  return (
    // ThemeProvider (which normally forces the ui class on <html>) is gone at
    // this boundary, and the color variables only exist under :root.ui.
    <html className="ui" lang="en">
      <body>
        {reloading ? null : (
          <div className="bg-background flex min-h-screen items-center justify-center p-4">
            <div className="w-full max-w-md text-center">
              <h1 className="text-primary mb-4 text-2xl font-bold">Oops! Something went wrong</h1>

              <p className="text-secondary mb-6 leading-relaxed">{errorMessage}</p>

              {errorDigest && (
                <div className="bg-fill-tertiary mb-6 rounded-lg p-3">
                  <p className="text-tertiary font-mono text-xs">Error ID: {errorDigest}</p>
                </div>
              )}

              <div className="flex flex-col gap-3">
                <button onClick={handleRetry}>Try Again</button>

                <button onClick={handleGoHome}>Go Home</button>
              </div>
            </div>
          </div>
        )}
      </body>
    </html>
  )
}

'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const REDIRECT_TARGET = '/home'
const REDIRECT_SECONDS = 3

export default function NotFound() {
  const router = useRouter()
  const [secondsLeft, setSecondsLeft] = useState(REDIRECT_SECONDS)

  useEffect(() => {
    const intervalId = setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    const timeoutId = setTimeout(() => {
      router.replace(REDIRECT_TARGET)
    }, REDIRECT_SECONDS * 1000)

    return () => {
      clearInterval(intervalId)
      clearTimeout(timeoutId)
    }
  }, [router])

  const handleGoHome = () => {
    router.replace(REDIRECT_TARGET)
  }

  const handleGoBack = () => {
    router.back()
  }

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <h1 className="text-primary mb-2 text-6xl font-bold">404</h1>
        <h2 className="text-primary mb-4 text-2xl font-semibold">Page not found</h2>
        <p className="text-secondary mb-6 leading-relaxed">
          The page you&apos;re looking for doesn&apos;t exist. Redirecting you to Home in{' '}
          <span className="text-primary font-semibold">{secondsLeft}</span>{' '}
          {secondsLeft === 1 ? 'second' : 'seconds'}&hellip;
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            className="bg-primary text-background rounded-md px-4 py-2 font-medium hover:opacity-90"
            onClick={handleGoHome}
            type="button"
          >
            Go to Home
          </button>
          <button
            className="text-secondary hover:text-primary rounded-md px-4 py-2 font-medium underline-offset-4 hover:underline"
            onClick={handleGoBack}
            type="button"
          >
            Go back
          </button>
        </div>
      </div>
    </div>
  )
}

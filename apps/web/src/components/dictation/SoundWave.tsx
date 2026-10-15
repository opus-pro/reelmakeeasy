'use client'

import { cn } from '@shared/ui'
import { useEffect, useRef, useState } from 'react'

/** Bars shown, and how often a new one comes in on the right. */
export const WAVE_BARS = 16
const STEP_MS = 90

/** The bars' heights, 0..1, for a history of levels (newest last), padded with silence. */
export function waveHeights(history: number[], bars = WAVE_BARS): number[] {
  const recent = history.slice(-bars)
  return [...new Array<number>(bars - recent.length).fill(0), ...recent].map((level) =>
    // Speech peaks sit around 0.1-0.4: lift them so talking fills the bar, silence stays a dot.
    Math.min(1, Math.sqrt(level) * 1.6),
  )
}

/**
 * A small sound wave while voice typing listens: a new bar for the mic's level comes in on the
 * right every 90 ms and the rest move left, so you can see it hears you and time is passing.
 */
export function SoundWave({ className, level }: { className?: string; level: number }) {
  const latest = useRef(level)
  latest.current = level
  const [history, setHistory] = useState<number[]>([])

  useEffect(() => {
    const timer = setInterval(() => {
      setHistory((prev) => [...prev.slice(-(WAVE_BARS - 1)), latest.current])
    }, STEP_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <span aria-hidden className={cn('flex h-5 items-center gap-px', className)}>
      {waveHeights(history).map((height, i) => (
        <span
          className="w-0.5 rounded-full bg-red-400 transition-[height] duration-75"
          key={i}
          style={{ height: `${Math.max(2, Math.round(height * 20))}px` }}
        />
      ))}
    </span>
  )
}

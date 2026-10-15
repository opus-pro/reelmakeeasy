'use client'

import { cn } from '@shared/ui/lib/utils'
import { motion } from 'framer-motion'
import { useEffect, useRef } from 'react'

interface CircularProgressProps {
  className?: string
  initValue?: number
  label?: string
  percentage: number
  size?: number
}

export function CircularProgress({
  percentage,
  initValue,
  label,
  size = 24,
  className,
}: CircularProgressProps) {
  // Calculate circle properties
  const radius = 42
  const circumference = 2 * Math.PI * radius

  // Track the previous percentage to avoid resetting to 0
  const prevPercentageRef = useRef<number>(initValue ?? percentage)

  useEffect(() => {
    if (percentage !== prevPercentageRef.current) {
      prevPercentageRef.current = percentage
    }
  }, [percentage])

  // Use initValue or previous value as starting point
  const initialPercentage = initValue ?? prevPercentageRef.current

  return (
    <div className={cn('flex items-center justify-center', className)}>
      <div className="relative flex items-center justify-center">
        {/* SVG Circle Progress */}
        <svg className="-rotate-90 transform" height={size} viewBox="0 0 100 100" width={size}>
          {/* Background circle - gray ring */}
          <circle
            className="stroke-secondary"
            cx="50"
            cy="50"
            fill="none"
            r={radius}
            strokeWidth="2"
          />
          {/* Progress circle - white ring */}
          <motion.circle
            animate={{
              strokeDashoffset: circumference - (percentage / 100) * circumference,
            }}
            className="stroke-white"
            cx="50"
            cy="50"
            fill="none"
            initial={{
              strokeDashoffset: circumference - (initialPercentage / 100) * circumference,
            }}
            key={`progress-${initValue ?? 0}`}
            r={radius}
            strokeDasharray={circumference}
            strokeLinecap="round"
            strokeWidth="2"
            transition={{
              duration: 0.8,
              ease: 'easeInOut',
            }}
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            animate={{ opacity: 1, scale: 1 }}
            className="text-sm text-primary"
            initial={{ opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            {percentage}%
          </motion.span>
          {label && (
            <motion.span
              animate={{ opacity: 1 }}
              className="text-xs text-white/80"
              initial={{ opacity: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              {label}
            </motion.span>
          )}
        </div>
      </div>
    </div>
  )
}

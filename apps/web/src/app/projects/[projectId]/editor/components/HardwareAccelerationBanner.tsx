'use client'

import { memo } from 'react'

interface HardwareAccelerationBannerProps {
  hardwareAccelerationUnavailable: boolean
}

// Shown when detectHardwareAcceleration() finds no GPU-backed WebGL context,
// replacing what would otherwise be an infinite loading spinner.
// A probe pass with a wasm-side failure is a separate, out-of-scope case.
const HardwareAccelerationBanner = ({
  hardwareAccelerationUnavailable,
}: HardwareAccelerationBannerProps) => {
  if (!hardwareAccelerationUnavailable) {
    return null
  }

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-menu-background/90 px-6 text-center">
      <div className="flex max-w-md flex-col gap-y-2 text-sm text-primary">
        <div className="font-medium">
          Please enable hardware acceleration in your browser to view this video.
        </div>
        <div>
          In Chrome: <span className="font-medium">chrome://settings/system</span> &rarr; &quot;Use
          graphics acceleration when available&quot;, then relaunch and reload this page.
        </div>
      </div>
    </div>
  )
}

export default memo(HardwareAccelerationBanner)

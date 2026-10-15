import type React from 'react'

/**
 * Centered mobile presentation for the project Share panel: a full-screen
 * backdrop (tap to dismiss) with the panel vertically centered above it. Shared
 * by the demo/share viewer (`DetailPanel`) and the mobile project list card
 * (`ProjectListCardV2`) so the two stay visually identical.
 *
 * Purely presentational: the caller owns the open state and mounts this only
 * when the overlay should be visible. Wrap a `ProjectSharePanel` as children.
 */
export function MobileShareOverlay({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-[63]" onClick={onClose} />
      <div className="fixed inset-x-0 top-1/2 z-[64] flex -translate-y-1/2 justify-center px-4">
        {children}
      </div>
    </>
  )
}

import { Suspense } from 'react'

import { StoryModePageContent } from './StoryModePageContent'

export default function StoryModePage() {
  return (
    <Suspense fallback={null}>
      <StoryModePageContent />
    </Suspense>
  )
}

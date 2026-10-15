import { Suspense } from 'react'

import { AgentPageContent } from './AgentPageContent'

export default function AgentPage() {
  return (
    <Suspense fallback={null}>
      <AgentPageContent />
    </Suspense>
  )
}

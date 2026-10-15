import { PersistedRedirect } from '@/components/PersistedRedirect'

export default function LongTakeProjectPage() {
  return <PersistedRedirect paramName="projectId" target="/story-mode" />
}

// For static export, we generate a placeholder route.
// The client-side router will handle dynamic project IDs.
export async function generateStaticParams() {
  return [{ projectId: 'placeholder' }]
}

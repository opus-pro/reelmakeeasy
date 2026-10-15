import ProjectPageClient from './ProjectPageClient'

// For static export, we generate a placeholder route
// The client-side router will handle dynamic project IDs
export async function generateStaticParams() {
  return [{ projectId: 'placeholder' }]
}
export default function ProjectPage() {
  return <ProjectPageClient />
}

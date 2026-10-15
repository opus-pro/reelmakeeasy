import { PersistedRedirect } from '@/components/PersistedRedirect'

export async function generateStaticParams() {
  return [{ projectId: 'placeholder' }]
}

export default function PProjectPage() {
  return <PersistedRedirect paramName="projectId" target="/projects" />
}

import SharePageClient from './SharePageClient'

// For static export, we generate a placeholder route
// The client-side router will handle dynamic project IDs
export async function generateStaticParams() {
  return [{ shareId: 'placeholder' }]
}

export default function SharePage() {
  return <SharePageClient />
}

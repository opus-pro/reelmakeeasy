import AppSidebar from '@/components/AppSidebar'

// The saved-brand library is off, so the page renders only the app chrome.
export default function BrandLibraryPage() {
  return (
    <div className="min-h-screen">
      <div className="flex min-h-screen flex-col md:flex-row">
        <AppSidebar />
        <main className="flex min-h-screen min-w-0 flex-1 flex-col" />
      </div>
    </div>
  )
}

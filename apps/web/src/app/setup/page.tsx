import AppSidebar from '@/components/AppSidebar'
import { VoiceTypingCard } from '@/components/dictation/VoiceTypingCard'
import { SetupPagePanel } from '@/components/setup/SetupEntry'

/** Setup: the keys found, the AI apps on this computer, who does what, and voice typing. */
export default function SetupPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen flex-col md:flex-row">
        <AppSidebar />
        <main className="flex min-h-screen min-w-0 flex-1 flex-col items-center px-4 pt-20 pb-10 md:px-12 md:pt-15">
          <div className="flex w-full max-w-[640px] flex-col gap-6">
            {/* The page's heading for screen readers; the cards below carry the visible titles. */}
            <h1 className="sr-only">Setup</h1>
            <SetupPagePanel />
            <VoiceTypingCard />
          </div>
        </main>
      </div>
    </div>
  )
}

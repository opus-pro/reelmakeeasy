import { cn } from '@shared/ui'

export function DashboardIntro({
  highlightTitle,
  isCreateMode,
}: {
  highlightTitle: string
  isCreateMode: boolean
}) {
  return (
    <h1
      className={cn(
        // -mb-2 tightens the parent's gap-4 (16px) down to the 8px
        // the design specifies between the title and the subtitle
        // that follows it (LongVideoLengthAnnouncementBanner).
        'text-primary text-2xl md:text-4xl font-semibold leading-tight tracking-[-1.08px] -mb-2',
        isCreateMode && 'hidden md:block',
      )}
    >
      <span>Create your </span>
      <span className="text-accent-orange">{highlightTitle}</span>
      <span> today</span>
    </h1>
  )
}

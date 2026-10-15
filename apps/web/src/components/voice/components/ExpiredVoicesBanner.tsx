import { Info } from '@/components/icons/core'

// Prompt users to recreate expired voice clones.
export function ExpiredVoicesBanner() {
  return (
    <div className="bg-menu-background flex items-center gap-2 rounded-md p-2">
      <Info className="size-4 shrink-0 text-icon-secondary" />
      <div className="text-text-light-secondary text-xs font-normal leading-[19px]">
        Custom voice model upgraded for better audio quality. Older custom voices expired.
      </div>
    </div>
  )
}

'use client'

import { toast } from '@shared/ui'

import { FirstVideoPrompt, type FirstVideoPromptProps } from './FirstVideoPrompt'
import { needsSetup } from './setup-status'
import { SetupCard } from './SetupCard'
import { useSetupStatus } from './useSetupStatus'

/** The home page's card: shown only while something is missing or a choice is pending. Once
 *  setup is complete (on load, or right after Save) a new user is asked to make a first video. */
export function HomeSetupCard({
  className,
  onBusyChange,
  onTryExample,
}: Pick<FirstVideoPromptProps, 'onBusyChange' | 'onTryExample'> & { className?: string }) {
  const state = useSetupStatus()
  const cardShowing = needsSetup(state.status)
  return (
    <>
      {cardShowing && (
        <div className={className}>
          <SetupCard onSaved={() => toast.success('Setup saved')} state={state} />
        </div>
      )}
      <FirstVideoPrompt
        cardShowing={cardShowing}
        checking={state.loading}
        onBusyChange={onBusyChange}
        onTryExample={onTryExample}
        status={state.status}
      />
    </>
  )
}

/** The Setup page: the card, always. */
export function SetupPagePanel() {
  const state = useSetupStatus()
  return <SetupCard onSaved={() => toast.success('Setup saved')} state={state} />
}

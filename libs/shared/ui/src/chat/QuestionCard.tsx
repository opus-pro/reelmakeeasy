import { motion } from 'framer-motion'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '../lib/utils'
import { OptionList } from '../option-list'

import { CHAT_FLOATING_CARD_SURFACE_CLASS } from './cardSurface'

// One-shot mount entrance (per the motion design). The freeText pill (and footer)
// render outside the animated body, so they are visible from the first frame; only the
// title+options body grows from height 0 while it fades in above the pill.
const MOUNT_ANIMATION_DURATION = 0.3
const MOUNT_ANIMATION_EASE = [0.5, 0, 0.5, 1] as const
const CARD_PADDING = 8

export type QuestionCardProps = {
  animateMount?: boolean
  footer?: ReactNode
  freeText?: ReactNode
  header?: ReactNode
  optionList: ComponentProps<typeof OptionList>
  title: string
}

export function QuestionCard({
  animateMount = true,
  footer,
  freeText,
  header,
  optionList,
  title,
}: QuestionCardProps) {
  return (
    <motion.div
      animate={{
        paddingBottom: CARD_PADDING,
        paddingLeft: CARD_PADDING,
        paddingRight: CARD_PADDING,
      }}
      className={cn(
        'flex w-full flex-col rounded-4xl border-[0.5px] border-subtle pt-2',
        CHAT_FLOATING_CARD_SURFACE_CLASS,
      )}
      data-testid="question-card"
      initial={animateMount ? { paddingBottom: 0, paddingLeft: 0, paddingRight: 0 } : false}
      transition={{ duration: MOUNT_ANIMATION_DURATION, ease: MOUNT_ANIMATION_EASE }}
    >
      <div className="flex flex-col gap-2">
        <motion.div
          animate={{
            height: 'auto',
            opacity: 1,
            paddingLeft: 0,
            paddingRight: 0,
            transitionEnd: { overflow: 'visible' },
          }}
          className="flex flex-col"
          data-testid="question-card-body"
          initial={
            animateMount
              ? {
                  height: 0,
                  opacity: 0,
                  overflow: 'hidden',
                  paddingLeft: CARD_PADDING,
                  paddingRight: CARD_PADDING,
                }
              : false
          }
          transition={{ duration: MOUNT_ANIMATION_DURATION, ease: MOUNT_ANIMATION_EASE }}
        >
          <div className="flex items-center gap-4 p-3">
            <p className="flex-1 text-[16px] font-medium leading-[20px] text-primary">{title}</p>
            {header}
          </div>

          {optionList.options.length > 0 ? <OptionList {...optionList} /> : null}
        </motion.div>

        {/* freeText must stay a sibling of OptionList, never passed through its `trailing` prop:
            OptionList's window Enter listener only leaves Enter alone for interactive controls
            outside its own div, and `trailing` renders inside it. It also stays a sibling of the
            height-animated body wrapper above so the pill is visible from the first mount frame. */}
        {freeText}
      </div>

      {footer}
    </motion.div>
  )
}

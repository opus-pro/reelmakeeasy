'use client'

import { QaRecap } from '@shared/ui/chat'

import type { QaRecapBlock } from '../state-types'

import { InlineMessageContent } from './InlineMessageContent'

export function QaRecapBlockItem({ block }: { block: QaRecapBlock }) {
  return (
    <QaRecap
      answer={
        <InlineMessageContent
          anchorAssets={block.answerAnchorAssets}
          text={block.answer}
          uploadedAssets={block.answerUploadedAssets}
        />
      }
      question={block.question}
    />
  )
}

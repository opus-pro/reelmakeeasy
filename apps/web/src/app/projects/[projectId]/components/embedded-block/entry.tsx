import {
  EmbeddedAttachmentBlock,
  EmbeddedBlockMessage,
  EmbeddedSourceBlock,
  EmbeddedStoryboardBlock,
  EmbeddedVideoBlock,
  EmbeddedVideoPlanBlock,
} from '@shared/types/chat/message-embedded-block'
import React, { isValidElement, memo, useMemo } from 'react'

import AttachmentBlock from './attachment-block'
import SourceBlock from './source-block'
import StoryboardBlock from './storyboard-block'
import VideoBlock from './video-block'
import VideoPlanBlock from './video-plan-block'

interface EmbeddedBlockEntryProps {
  entry: EmbeddedBlockMessage
}

const EmbeddedBlockEntry: React.FC<EmbeddedBlockEntryProps> = ({ entry }) => {
  const block = useMemo(() => {
    if (entry.type === 'embedded-video') {
      return <VideoBlock msg={entry as EmbeddedVideoBlock} />
    }
    if (entry.type === 'embedded-attachment') {
      if (entry.content?.title === 'style.png') {
        return null
      }
      return <AttachmentBlock msg={entry as EmbeddedAttachmentBlock} />
    }
    if (entry.type === 'embedded-source') {
      return <SourceBlock msg={entry as EmbeddedSourceBlock} />
    }
    if (entry.type === 'embedded-storyboard') {
      return <StoryboardBlock msg={entry as EmbeddedStoryboardBlock} />
    }
    if (entry.type === 'embedded-video-plan') {
      return <VideoPlanBlock msg={entry as EmbeddedVideoPlanBlock} />
    }
    return null
  }, [entry])

  const shouldRender = useMemo(() => {
    if (!block) {
      return false
    }
    if (isValidElement(block)) {
      const props = block.props as { children?: React.ReactNode }
      if (block.type === React.Fragment && !props.children) {
        return false
      }
    }
    return true
  }, [block])

  return shouldRender ? block : null
}

export default memo(EmbeddedBlockEntry)

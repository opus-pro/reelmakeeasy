import { Logger } from '@reelmakeeasy/common/utils/logger'
import { toast } from '@shared/ui'
import { useRef } from 'react'

import type { ChatBoxMode } from '@/atom/home'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useEnhancer } from '@/hooks/useEnhancer'
import { getErrorMessage } from '@/util/error-message'

const nsLogger = Logger.get('omni-chat-box')

export function useEnhancerHandlers(
  message: string,
  editorRef: React.RefObject<null | { initWithValue: (value: string) => void }>,
  setChatBoxMode: (mode: ChatBoxMode) => void,
) {
  const { enhancePrompt, isEnhancing } = useEnhancer()
  const originalContentRef = useRef<string>('')
  const originalTimeRef = useRef<number>(0)
  const enhancedContentRef = useRef<string>('')

  const handleEnhancePrompt = useRefCallback(async () => {
    const prompt = message.trim()
    if (!prompt.length) {
      return
    }
    originalContentRef.current = prompt
    originalTimeRef.current = Date.now()
    // Switch to enhance-review mode before awaiting so the in-flight UI
    // (enhance-review border + status text) renders during the request.
    setChatBoxMode('enhance-review')
    try {
      const enhancedText = await enhancePrompt(prompt)
      enhancedContentRef.current = enhancedText
      editorRef.current?.initWithValue(enhancedText)
    } catch (error) {
      setChatBoxMode('edit')
      const errorMessage = getErrorMessage(error, 'Prompt enhancement failed. Try again later.')
      toast.error(errorMessage)
      nsLogger.error('Enhance prompt error:', error)
    }
  })

  const handleDiscardEnhance = useRefCallback(() => {
    editorRef.current?.initWithValue(originalContentRef.current)
    setChatBoxMode('edit')
    originalContentRef.current = ''
    enhancedContentRef.current = ''
  })

  const handleKeepEnhance = useRefCallback(() => {
    setChatBoxMode('edit')
    originalContentRef.current = ''
    enhancedContentRef.current = ''
  })

  return {
    handleDiscardEnhance,
    handleEnhancePrompt,
    handleKeepEnhance,
    isEnhancing,
  }
}

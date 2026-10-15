import { useCallback, useEffect, useMemo, useState } from 'react'

type PromptState = {
  isDirty: boolean
  shotId: null | string
  value: string
}

export const useShotPrompt = (
  shotId: null | string,
  shotDescription: string | undefined,
  shotMetaPrompt: string | undefined,
) => {
  const basePrompt = useMemo(() => {
    return shotMetaPrompt ?? shotDescription ?? ''
  }, [shotMetaPrompt, shotDescription])

  const [state, setState] = useState<PromptState>({
    isDirty: false,
    shotId,
    value: basePrompt,
  })

  useEffect(() => {
    setState((prev) => {
      if (shotId !== prev.shotId) {
        return {
          isDirty: false,
          shotId,
          value: basePrompt,
        }
      }
      if (!prev.isDirty && prev.value !== basePrompt) {
        return { ...prev, value: basePrompt }
      }
      return prev
    })
  }, [shotId, basePrompt])

  const setPrompt = useCallback((value: string) => {
    setState((prev) => ({
      ...prev,
      isDirty: true,
      value,
    }))
  }, [])

  const markPromptSynced = useCallback((value?: string) => {
    setState((prev) => ({
      ...prev,
      isDirty: false,
      value: value ?? prev.value,
    }))
  }, [])

  return {
    markPromptSynced,
    prompt: state.value,
    setPrompt,
  }
}

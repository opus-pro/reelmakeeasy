import { ChatBoxMessage } from '@shared/types/chat/message'

const joinText = (prev?: string, curr?: string): string => {
  const endingChar = prev?.at(-1)
  const headingChar = curr?.at(0) ?? ''
  // joinMultilineText
  if (endingChar === '.' && /^\S/.test(headingChar)) {
    return `${prev ?? ''}\n${curr ?? ''}`
  }
  return (prev ?? '') + (curr ?? '')
}

/**
 * Folds a history message into the list: consecutive text-delta / reasoning chunks
 * are joined into one entry and embedded-video-plan pushes are merged by refId.
 */
export function mergeChatMessage(prev: ChatBoxMessage[], newMsg: ChatBoxMessage): ChatBoxMessage[] {
  const lastItem = prev?.at(-1)
  const newMsgType = newMsg.type
  const isFinish = newMsgType === 'finish'
  const isReasoning = newMsgType === 'reasoning'
  const isTextDelta = newMsgType === 'text-delta'
  const bothTextDelta = lastItem?.type === 'text-delta' && (isTextDelta || isFinish)
  const bothReasoning = lastItem?.type === 'reasoning' && isReasoning

  // Handle embedded-video-plan merge by refId
  // Multiple pushes (title/references/transcript) should merge into one card
  if (newMsgType === 'embedded-video-plan' && newMsg.content?.refId) {
    const existingIdx = prev.findIndex(
      (m) => m.type === 'embedded-video-plan' && m.content?.refId === newMsg.content?.refId,
    )
    if (existingIdx !== -1) {
      const existing = prev[existingIdx]
      const existingData = existing.content?.data || {}
      const newData = newMsg.content?.data || {}

      // Deep merge data, with special handling for transcript
      const mergedData = {
        ...existingData,
        ...newData,
        // Deep merge transcript if both exist
        ...(newData.transcript && {
          transcript: {
            ...existingData.transcript,
            ...newData.transcript,
          },
        }),
      }

      const mergedMsg = {
        ...existing,
        ...newMsg,
        content: {
          ...existing.content,
          ...newMsg.content,
          data: mergedData,
        },
        _feUpdatedAt: new Date().toISOString(),
      } as ChatBoxMessage

      return [...prev.slice(0, existingIdx), mergedMsg, ...prev.slice(existingIdx + 1)]
    }
  }

  if (bothTextDelta || bothReasoning) {
    const item = { ...lastItem }
    item._feRaw = (lastItem._feRaw ? [...lastItem._feRaw, newMsg] : [newMsg]).toSorted(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    item.text = item._feRaw.reduce((text, msg) => joinText(text, msg.text), '')
    item._feUpdatedAt = new Date().toISOString()
    return [...prev.slice(0, -1), item]
  }
  if (isReasoning || isTextDelta) {
    newMsg._feRaw = [{ ...newMsg }]
  }
  const item = { ...newMsg, _feUpdatedAt: new Date().toISOString() } as ChatBoxMessage
  return [...prev, item]
}

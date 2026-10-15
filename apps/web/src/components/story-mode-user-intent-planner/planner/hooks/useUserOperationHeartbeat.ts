'use client'

import { throttle } from 'lodash-es'
import { useEffect, useMemo, useRef } from 'react'

import { getApiAtom } from '../../state/atoms/planner'
import { usePlannerState } from '../../state/planner-context'
import type { PlannerState } from '../../state/planner-state'

const EVENT_OPTIONS: AddEventListenerOptions = { capture: true, passive: true }
const INPUT_EVENT_OPTIONS: AddEventListenerOptions = { capture: true }

const WINDOW_EVENTS: Array<{ eventName: string; options: AddEventListenerOptions }> = [
  { eventName: 'mousemove', options: EVENT_OPTIONS },
  { eventName: 'pointermove', options: EVENT_OPTIONS },
  { eventName: 'pointerdown', options: EVENT_OPTIONS },
  { eventName: 'keydown', options: INPUT_EVENT_OPTIONS },
  { eventName: 'input', options: INPUT_EVENT_OPTIONS },
  { eventName: 'beforeinput', options: INPUT_EVENT_OPTIONS },
  { eventName: 'compositionupdate', options: INPUT_EVENT_OPTIONS },
  { eventName: 'change', options: INPUT_EVENT_OPTIONS },
  { eventName: 'paste', options: INPUT_EVENT_OPTIONS },
  { eventName: 'drop', options: EVENT_OPTIONS },
  { eventName: 'wheel', options: EVENT_OPTIONS },
  { eventName: 'touchstart', options: EVENT_OPTIONS },
  { eventName: 'touchmove', options: EVENT_OPTIONS },
  { eventName: 'scroll', options: EVENT_OPTIONS },
  { eventName: 'focus', options: EVENT_OPTIONS },
]

const DOCUMENT_EVENTS: Array<{ eventName: string; options: AddEventListenerOptions }> = [
  { eventName: 'visibilitychange', options: EVENT_OPTIONS },
]

const notifyCallbacks = new Set<() => void>()
let listenersBound = false

export function UserOperationHeartbeatEffect(): null {
  const state = usePlannerState()
  useUserOperationHeartbeat(state)
  return null
}

export function useUserOperationHeartbeat(state: PlannerState): void {
  const startedRef = useRef(false)

  const notifyUserOperation = useMemo(
    () =>
      throttle(() => {
        state.get(getApiAtom)?.userOperationHeartbeat()
      }, 1000),
    [state],
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      startedRef.current = true
    }, 1000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const notify = () => {
      if (!startedRef.current) {
        return
      }
      notifyUserOperation()
    }

    notifyCallbacks.add(notify)
    ensureListeners()

    return () => {
      notifyCallbacks.delete(notify)
      notifyUserOperation.cancel()
      if (notifyCallbacks.size === 0) {
        teardownListeners()
      }
    }
  }, [state])
}

function ensureListeners(): void {
  if (listenersBound || typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }
  for (const event of WINDOW_EVENTS) {
    window.addEventListener(event.eventName, handleUserOperation, event.options)
  }
  for (const event of DOCUMENT_EVENTS) {
    document.addEventListener(event.eventName, handleVisibilityOperation, event.options)
  }
  listenersBound = true
}

function handleUserOperation(): void {
  if (document.visibilityState !== 'visible') {
    return
  }
  for (const notify of notifyCallbacks) {
    notify()
  }
}

function handleVisibilityOperation(): void {
  if (document.visibilityState !== 'visible') {
    return
  }
  handleUserOperation()
}

function teardownListeners(): void {
  if (!listenersBound || typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }
  for (const event of WINDOW_EVENTS) {
    window.removeEventListener(event.eventName, handleUserOperation, event.options)
  }
  for (const event of DOCUMENT_EVENTS) {
    document.removeEventListener(event.eventName, handleVisibilityOperation, event.options)
  }
  listenersBound = false
}

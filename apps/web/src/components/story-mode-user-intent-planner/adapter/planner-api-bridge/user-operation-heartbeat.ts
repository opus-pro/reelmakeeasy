import { CoalescingQueue } from '@reelmakeeasy/common/utils/coalescing-queue'

import { getRenderStateAtom } from '../../state/atoms/planner'
import type { PlannerState } from '../../state/planner-state'

export const USER_OPERATION_HEARTBEAT_THROTTLE_MS = 30_000

type HeartbeatRegistration = {
  plannerState: PlannerState
  projectId: string
  sendHeartbeat: () => Promise<void>
}

type HeartbeatSlot = {
  lastSentAt: null | number
  pending: boolean
  queue: CoalescingQueue<void>
  timerId: null | ReturnType<typeof setTimeout>
}

const registrations = new Map<symbol, HeartbeatRegistration>()
const slotsByProjectId = new Map<string, HeartbeatSlot>()

export function registerUserOperationHeartbeat(params: HeartbeatRegistration): () => void {
  const token = Symbol(params.projectId)
  registrations.set(token, params)

  return () => {
    registrations.delete(token)
    clearInactiveProjectSlots()
  }
}

export function resetUserOperationHeartbeatForTests(): void {
  registrations.clear()
  for (const slot of slotsByProjectId.values()) {
    clearSlotTimer(slot)
  }
  slotsByProjectId.clear()
}

export function triggerUserOperationHeartbeat(projectId: string): void {
  const registration = findActiveRegistration(projectId)
  if (!registration) {
    return
  }
  scheduleHeartbeat(registration)
}

function canSendHeartbeat(plannerState: PlannerState): boolean {
  const renderState = plannerState.get(getRenderStateAtom)
  return (
    renderState.status === 'active' &&
    (renderState.phase === 'script_review' || renderState.phase === 'refinement')
  )
}

function clearInactiveProjectSlots(): void {
  const activeProjectIds = new Set(
    Array.from(registrations.values()).map((registration) => registration.projectId),
  )
  for (const [projectId, slot] of slotsByProjectId) {
    if (!activeProjectIds.has(projectId)) {
      clearSlotTimer(slot)
      slotsByProjectId.delete(projectId)
    }
  }
}

function clearSlotTimer(slot: HeartbeatSlot): void {
  if (!slot.timerId) {
    return
  }
  clearTimeout(slot.timerId)
  slot.timerId = null
}

function findActiveRegistration(projectId: string): HeartbeatRegistration | null {
  let active: HeartbeatRegistration | null = null
  for (const registration of registrations.values()) {
    if (registration.projectId === projectId && canSendHeartbeat(registration.plannerState)) {
      active = registration
    }
  }
  return active
}

function getSlot(projectId: string): HeartbeatSlot {
  const existing = slotsByProjectId.get(projectId)
  if (existing) {
    return existing
  }
  const slot: HeartbeatSlot = {
    lastSentAt: null,
    pending: false,
    queue: new CoalescingQueue<void>(),
    timerId: null,
  }
  slotsByProjectId.set(projectId, slot)
  return slot
}

function scheduleHeartbeat(registration: HeartbeatRegistration): void {
  const slot = getSlot(registration.projectId)
  if (slot.queue.isRunning) {
    slot.pending = true
    return
  }

  const now = Date.now()
  if (slot.lastSentAt === null || now - slot.lastSentAt >= USER_OPERATION_HEARTBEAT_THROTTLE_MS) {
    void sendHeartbeatNow(registration)
    return
  }

  slot.pending = true
  if (slot.timerId) {
    return
  }
  const delay = Math.max(0, USER_OPERATION_HEARTBEAT_THROTTLE_MS - (now - slot.lastSentAt))
  slot.timerId = setTimeout(() => {
    slot.timerId = null
    const activeRegistration = findActiveRegistration(registration.projectId)
    if (activeRegistration && slot.pending) {
      void sendHeartbeatNow(activeRegistration)
    }
  }, delay)
}

async function sendHeartbeatNow(registration: HeartbeatRegistration): Promise<void> {
  const slot = getSlot(registration.projectId)
  if (slot.queue.isRunning) {
    slot.pending = true
    return
  }

  clearSlotTimer(slot)
  slot.pending = false
  slot.lastSentAt = Date.now()

  try {
    await slot.queue.push(() => registration.sendHeartbeat())
  } catch {
    // Presence heartbeats are best-effort and should never interrupt UIP interactions.
  } finally {
    const activeRegistration = findActiveRegistration(registration.projectId)
    if (activeRegistration && slot.pending) {
      scheduleHeartbeat(activeRegistration)
    }
  }
}

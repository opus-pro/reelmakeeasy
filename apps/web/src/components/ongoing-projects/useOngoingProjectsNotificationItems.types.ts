import type { OngoingProjectsNotificationItem } from './OngoingProjectsNotificationView'

export type OngoingProjectsNotificationItemsResult = {
  allTotal: number
  error: null | unknown
  isConnected: boolean
  isLoading: boolean
  isReconnecting: boolean
  items: OngoingProjectsNotificationItem[]
  loadMore: () => Promise<void> | void
  ongoingTotal: number
  reconnect: () => void
}

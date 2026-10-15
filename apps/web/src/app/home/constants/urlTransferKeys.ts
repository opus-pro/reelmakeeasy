import type { ApplyLongTakeTemplatePayload, ApplyQuickStartTemplatePayload } from '@/atom/home'
import { defineUrlTransferKey } from '@/hooks/useUrlTransfer'

export const RECREATE_QUERY_KEY = defineUrlTransferKey<ApplyQuickStartTemplatePayload>('recreate')
export const USE_THIS_STYLE_QUERY_KEY =
  defineUrlTransferKey<ApplyLongTakeTemplatePayload>('use-this-style')
export const REMIX_QUERY_KEY = defineUrlTransferKey<ApplyLongTakeTemplatePayload>('remix')

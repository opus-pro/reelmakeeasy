'use client'

import type { AgentSessionListItem } from '@shared/types/api/agent'
import { Button, Dialog, toast } from '@shared/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { getProjectsQueryKeyPrefix } from '@/hooks/projects-query-utils'
import { useApi } from '@/hooks/useApi'

/** Confirms and deletes an agent chat. Its project, if any, is kept. */
export function DeleteChatDialog({
  item,
  onClose,
  onDeleted,
}: {
  item: AgentSessionListItem | null
  onClose: () => void
  onDeleted: (id: string) => void
}) {
  const { fetchApiDomain } = useApi()
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!item || deleting) return
    setDeleting(true)
    try {
      const res = await fetchApiDomain(`/api/agent/sessions/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
        noThrowError: true,
      })
      if (!res.ok) {
        toast.error(res.error || "Couldn't delete the chat")
        return
      }
      // The Projects page's "Open chat" item comes from this same chat id: without this, a
      // cached Projects page keeps showing it for a chat that no longer exists.
      void queryClient.invalidateQueries({ queryKey: getProjectsQueryKeyPrefix() })
      onDeleted(item.id)
      onClose()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog
      classNames={{
        content:
          'backdrop-blur-2xl bg-menu/50 border-tertiary rounded-2xl p-6 max-w-[440px] max-sm:max-w-[90%]',
        description: 'text-secondary text-sm leading-[22px]',
        footer: 'gap-2 justify-end pt-4',
        header: 'gap-4 pb-4',
        title: 'text-primary text-lg font-semibold leading-[21.8px]',
      }}
      description={
        item?.project && !item.project.deleted
          ? 'This deletes the chat. Its video stays in your projects.'
          : "Once deleted, this chat can't be recovered."
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button
            className="rounded-sm bg-white/10 px-2.5 hover:bg-white/20"
            disabled={deleting}
            onClick={onClose}
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            className="rounded-sm bg-white px-2.5 text-black hover:bg-white/90"
            disabled={deleting}
            onClick={() => void handleDelete()}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      }
      onCancel={onClose}
      onOpenChange={(open) => !open && onClose()}
      open={!!item}
      showClose
      title="Delete this chat?"
    />
  )
}

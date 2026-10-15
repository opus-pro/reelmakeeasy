'use client'

import { useAtomValue } from 'jotai'

import { removeDraftFileUploadById } from '../../state/actions/draft-upload-actions'
import { getDraftFileUploadsAtom } from '../../state/atoms/planner'
import { usePlannerState } from '../../state/planner-context'

import { DraftUploadThumbnail } from './DraftUploadThumbnail'

export function DraftUploadThumbnailList() {
  const state = usePlannerState()
  const uploads = useAtomValue(getDraftFileUploadsAtom(state))

  if (uploads.length === 0) {
    return null
  }

  return (
    <div className="flex max-w-[140px] flex-wrap items-center gap-1 self-center">
      {uploads.map((upload) => (
        <DraftUploadThumbnail
          key={upload.id}
          onRemove={() => {
            removeDraftFileUploadById(state, upload.id)
          }}
          upload={upload}
        />
      ))}
    </div>
  )
}

'use client'

import { Button, Dialog } from '@shared/ui'
import { useAtom } from 'jotai'
import Image from 'next/image'

import { deleteProjectDialogAtom } from '@/atom/delete-project-dialog'
import { useDeleteProject } from '@/hooks/useProjects'
import { getPublicCdnUrl } from '@/util/cdn-utils'
import { formatDate } from '@/util/date-format'

const VIDEO_THUMBNAIL_URL = getPublicCdnUrl('agent/images/styles/video-placeholder.png')

export function DeleteProjectDialog() {
  const [dialogState, setDialogState] = useAtom(deleteProjectDialogAtom)
  const { deleteProjectAsync, isDeleting } = useDeleteProject()

  const project = dialogState.project
  const open = dialogState.open

  const handleClose = () => {
    setDialogState({ open: false, project: null })
  }

  const handleCancel = () => {
    handleClose()
  }

  const handleDelete = async () => {
    if (!project) {
      return
    }
    await deleteProjectAsync(project.id)
    handleClose()
  }

  const isDeletingAny = isDeleting

  const projectName = project?.name || project?.initPrompt || 'this project'
  const projectDate = project?.createdAt ? formatDate(project.createdAt, 'MMM d, yyyy') : ''

  return (
    <Dialog
      classNames={{
        content:
          'backdrop-blur-2xl bg-menu/50 border-tertiary rounded-2xl p-6 max-w-[440px] max-sm:max-w-[90%]',
        header: 'gap-4 pb-4',
        title: 'text-primary text-lg font-semibold leading-[21.8px]',
        description: 'text-secondary text-sm leading-[22px]',
        footer: 'gap-2 justify-end pt-4',
      }}
      description="Once deleted, this project can't be recovered. Are you sure you want to delete it?"
      footer={
        <div className="flex gap-2 items-center justify-end">
          <Button
            className="px-2.5 rounded-sm bg-white/10 hover:bg-white/20"
            disabled={isDeletingAny}
            onClick={handleCancel}
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            className="px-2.5 rounded-sm bg-white text-black hover:bg-white/90"
            disabled={isDeletingAny}
            onClick={handleDelete}
          >
            {isDeletingAny ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      }
      onCancel={handleCancel}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          handleClose()
        }
      }}
      open={open}
      showClose={true}
      title="Delete this project?"
    >
      {project && (
        <div className="flex gap-2 border border-tertiary h-[58px] items-center p-2.5 rounded-xl w-full min-w-0 overflow-hidden">
          <div className="border border-tertiary relative rounded size-10 shrink-0 overflow-hidden">
            <Image
              alt="project thumbnail"
              className="object-cover object-center rounded-1"
              fill
              src={project.previewThumbnail || VIDEO_THUMBNAIL_URL}
            />
          </div>
          <div className="flex flex-col gap-0.5 items-start flex-1 min-w-0 overflow-hidden">
            <p className="text-primary text-sm font-medium leading-[17px] truncate w-full">
              {projectName}
            </p>
            {projectDate && (
              <p className="text-secondary text-xs leading-[19px] truncate w-full">{projectDate}</p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}

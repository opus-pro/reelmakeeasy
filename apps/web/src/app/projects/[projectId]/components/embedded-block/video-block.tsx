import { EmbeddedVideoBlock } from '@shared/types/chat/message-embedded-block'
import { Button } from '@shared/ui'
import { useAsyncEffect } from 'ahooks'
import { useSetAtom } from 'jotai'
import { useMemo } from 'react'

import { isEditorModeAtom } from '@/atom/sceneCanvas'
import { useFileUrl } from '@/hooks/use-file-url'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useProjectAtom } from '@/hooks/useProjects'
import { useIsMobile } from '@/util/browserUtils'
import { formatDate } from '@/util/date-format'

import { useEditorSettings } from '../../editor/hooks/useEditorSettings'

export default function VideoBlock({ msg }: { msg: EmbeddedVideoBlock }) {
  const { addImgHostname } = useFileUrl()
  const { projectInfo, setProjectInfo, refetchProjectInfo } = useProjectAtom()
  const videoUrl = addImgHostname(msg.content?.url)
  const thumbnailUrl = addImgHostname(projectInfo?.resultVideoThumbnail)
  const setIsEditorMode = useSetAtom(isEditorModeAtom)
  const { enableVideoEditor } = useEditorSettings()
  const isMobile = useIsMobile()

  useAsyncEffect(async () => {
    if (videoUrl && !projectInfo?.resultVideo) {
      const { data } = await refetchProjectInfo()
      data && setProjectInfo(data)
    }
  }, [videoUrl, projectInfo?.resultVideo])

  const projectTitle = useMemo(
    () => projectInfo?.name || projectInfo?.initPrompt || 'Untitled Video',
    [projectInfo?.name, projectInfo?.initPrompt],
  )

  const projectDate = useMemo(
    () => projectInfo?.updatedAt || projectInfo?.createdAt,
    [projectInfo?.updatedAt, projectInfo?.createdAt],
  )

  const handleOpenInEditor = useRefCallback(() => {
    setIsEditorMode(true)
  })

  return (
    <div className="flex w-full flex-col gap-1 my-2">
      {/* Video Card */}
      <div className="bg-fill-secondary hover:bg-fill-hover flex w-full flex-col gap-3 rounded-md p-3 transition-colors">
        {/* Video info section */}
        <div className="flex items-center gap-3">
          {/* Thumbnail */}
          <div className="group relative aspect-[3/4] w-16 shrink-0 overflow-hidden rounded-xs">
            {thumbnailUrl ? (
              <img
                alt="thumbnail"
                className="size-full object-cover transition-transform duration-300 ease-out group-hover:scale-110"
                src={thumbnailUrl}
              />
            ) : (
              <video
                className="size-full object-cover transition-transform duration-300 ease-out group-hover:scale-110"
                preload="auto"
                src={videoUrl}
              />
            )}
          </div>

          {/* Info */}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-primary line-clamp-2 text-sm font-medium leading-tight">
              {projectTitle}
            </p>
            {projectDate && (
              <p className="text-secondary text-xs leading-relaxed">
                {formatDate(projectDate, 'MMM d HH:mm')}
              </p>
            )}
          </div>
        </div>

        {/* Open in Editor button - only show when editor feature is enabled and not on mobile */}
        {enableVideoEditor && !isMobile && (
          <Button
            className="rounded-sm px-3 w-full hover:opacity-90 transition-opacity h-8"
            onClick={handleOpenInEditor}
            variant="primary"
          >
            Continue editing
          </Button>
        )}
      </div>
    </div>
  )
}

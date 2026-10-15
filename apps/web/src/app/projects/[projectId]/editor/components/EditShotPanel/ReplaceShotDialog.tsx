import { Button, cn, Dialog, ScrollArea, toast } from '@shared/ui'
import { useRef } from 'react'

import { Add, CheckMark } from '@/components/icons/core'
import {
  getMaxFileSizeForEditor,
  MAX_EDITOR_IMAGE_SIZE_MB,
  MAX_EDITOR_VIDEO_SIZE_MB,
} from '@/constants/file'
import { useRefCallback } from '@/hooks/use-ref-callback'

/**
 * Upload-only. The dialog used to offer a "Choose media" grid
 * beside the upload button, but that grid was fed by `useSceneReferences`, whose
 * `storyboard/{sceneId}/references.json` the current pipeline never writes -- so
 * it rendered "No assets available" for every project, `selectedAsset` could
 * never leave null, and the Confirm button was permanently disabled. Uploading
 * fires `onFileSelect` directly, so nothing is left to confirm.
 */
interface ReplaceShotDialogProps {
  isUploading?: boolean
  onCancel: () => void
  onFileSelect: (file: File) => void
  open: boolean
}

export function ReplaceShotDialog({
  isUploading,
  onCancel,
  onFileSelect,
  open,
}: ReplaceShotDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleOpenChange = useRefCallback((isOpen: boolean) => {
    if (!isOpen) {
      onCancel()
    }
  })

  const handleCancel = useRefCallback(() => {
    onCancel()
  })

  const handleUploadClick = useRefCallback(() => {
    fileInputRef.current?.click()
  })

  const handleFileChange = useRefCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Check file size based on file type
      const { maxSizeBytes, maxSizeMB } = getMaxFileSizeForEditor(file)

      if (file.size > maxSizeBytes) {
        toast.warning(`File size exceeds ${maxSizeMB}MB`)
        // Clear the input value so the same file can be selected again
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        return
      }

      onFileSelect(file)
      // Clear the input value so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  })

  return (
    <Dialog
      classNames={{
        content:
          'border-none bg-menu-background backdrop-blur-2xl rounded-lg p-6 max-w-lg min-[1920px]:max-w-[800px]',
        footer: 'flex items-center justify-end gap-2',
      }}
      description="Upload media to replace this shot."
      onCancel={handleCancel}
      onOpenChange={handleOpenChange}
      open={open}
      title="Replace"
    >
      <ScrollArea className="max-h-[60vh]">
        <div className="flex flex-col gap-4 pr-2">
          {/* Upload area */}
          <Button
            className={cn(
              'flex flex-col items-center justify-center gap-2 py-5 w-full h-auto',
              'rounded-xl border-2 border-dashed border-subtle',
              'bg-menu-background hover:bg-fill-hover transition-colors',
            )}
            disabled={isUploading}
            loading={isUploading}
            onClick={handleUploadClick}
            variant="ghost"
          >
            <div className="flex flex-col items-center gap-1">
              <Add className="size-6 text-primary" />
              <span className="text-sm font-medium text-primary">Upload image or video</span>
            </div>
            <div className="flex flex-col items-center">
              <div className="flex items-center gap-1">
                <CheckMark className="size-3.5 text-secondary" />
                <span className="text-xs text-secondary">
                  MP4 up to {MAX_EDITOR_VIDEO_SIZE_MB}MB
                </span>
              </div>
              <div className="flex items-center gap-1">
                <CheckMark className="size-3.5 text-secondary" />
                <span className="text-xs text-secondary">
                  PNG, JPEG up to {MAX_EDITOR_IMAGE_SIZE_MB}MB
                </span>
              </div>
            </div>
          </Button>
        </div>
      </ScrollArea>

      {/* Hidden file input */}
      <input
        accept="image/png,image/jpeg,image/jpg,image/webp,video/*"
        className="hidden"
        multiple={false}
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />
    </Dialog>
  )
}

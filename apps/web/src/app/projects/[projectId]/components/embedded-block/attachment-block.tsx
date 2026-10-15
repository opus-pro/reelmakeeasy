import { EmbeddedAttachmentBlock } from '@shared/types/chat/message-embedded-block'
import { cn } from '@shared/ui'

import { AttachmentItem } from '@/components/omni-chat-box/AttachmentItem'
import { useFileUrl } from '@/hooks/use-file-url'

export default function AttachmentBlock({ msg }: { msg: EmbeddedAttachmentBlock }) {
  const { addImgHostname } = useFileUrl()
  const isFromUser = msg.from === 'user'
  return (
    <div
      className={cn(
        'relative rounded-md overflow-hidden border-none cursor-pointer',
        isFromUser ? 'justify-self-end' : 'justify-self-start',
      )}
    >
      <AttachmentItem
        canClose={false}
        isUploading={false}
        name={msg.content?.title}
        previewImage={
          msg.content?.previewImageUrl ? addImgHostname(msg.content?.previewImageUrl) : ''
        }
        type={msg.content?.mime}
      />
    </div>
  )
}

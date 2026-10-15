import { z } from 'zod'

export const ProjectAttachmentItemDtoSchema = z.object({
  id: z.string(),
  mime: z.string(),
  name: z.string().nullable(),
  previewImageUrl: z.string().nullable(),
  uri: z.string(),
})

export type ProjectAttachmentItemDto = z.infer<typeof ProjectAttachmentItemDtoSchema>

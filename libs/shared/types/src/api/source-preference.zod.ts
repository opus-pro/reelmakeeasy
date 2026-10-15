import { z } from 'zod'

export const SourcePreferenceDtoSchema = z.object({
  blockedSites: z.array(z.string()),
  id: z.string(),
  orgId: z.string().nullable(),
  userId: z.string(),
  youtubeFilter: z.string(),
})

export type SourcePreferenceDto = z.infer<typeof SourcePreferenceDtoSchema>

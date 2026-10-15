import { z } from 'zod'

export const FeedbackRequestBodySchema = z.object({
  dislikeCustomReason: z.string().optional(),
  dislikeOption: z.string().optional(),
  liked: z.boolean().optional(),
})

export type FeedbackRequestBody = z.infer<typeof FeedbackRequestBodySchema>
export type FeedbackSubmitResponse = {
  id: string
}

import { z } from 'zod'

export const EnhancePromptBody = z.object({
  prompt: z.string().min(1, { message: 'Prompt cannot be empty' }),
})

export type EnhancePromptBodyType = z.infer<typeof EnhancePromptBody>

export const EnhancePromptResponse = z.object({
  enhancedPrompt: z.string(),
})

export type EnhancePromptResponseType = z.infer<typeof EnhancePromptResponse>

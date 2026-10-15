import { Logger } from '@reelmakeeasy/common/logger'
import { UserInfo } from '@reelmakeeasy/common/types/user'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'

export function handleStoryModeStartWorkflowFailure(params: {
  error: unknown
  logger: Logger
  resolvedProjectId: string
  user: UserInfo
}): void {
  const { error, logger, resolvedProjectId, user } = params
  const err = ensureError(error)
  logger.error(
    `Failed to start Story Mode workflow ${JSON.stringify({
      projectId: resolvedProjectId,
      userId: user.sub,
      error: { message: err.message, name: err.name },
    })}`,
  )
}

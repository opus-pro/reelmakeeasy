export const LONG_TAKE_STATUS_KEY_PREFIX = 'long-take:status:'
export const LONG_TAKE_REQUEST_KEY_PREFIX = 'long-take:request:'

export const LONG_TAKE_STATUS_TTL_SECONDS = 259200

export function getLongTakeRequestKey(projectId: string): string {
  return `${LONG_TAKE_REQUEST_KEY_PREFIX}${projectId}`
}

export function getLongTakeStatusKey(projectId: string): string {
  return `${LONG_TAKE_STATUS_KEY_PREFIX}${projectId}`
}

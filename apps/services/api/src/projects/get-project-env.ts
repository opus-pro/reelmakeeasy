import { ProjectEnv } from '@shared/types/api/project'

/**
 * The `env` stamped on new projects and used to filter the projects list. One
 * value whatever NODE_ENV says, so a production build shows the same projects
 * as a dev server.
 */
export function getProjectEnv(): ProjectEnv {
  return 'DEV'
}

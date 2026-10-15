import { SourcePreferenceDto } from '../source-preference.zod'

/**
 * Abstraction for per-user source / YouTube preference data.
 */
export interface SourcePreferenceDataService {
  /**
   * Returns the stored source preference for a user, if any.
   */
  getSourcePreferenceByUserId(userId: string): Promise<null | SourcePreferenceDto>
}

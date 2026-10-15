/**
 * Database Dump Data Service
 *
 * Service interface for collecting database records for evaluation archival.
 */

/**
 * Service for collecting database data for project archival.
 * Used by DatabaseCollector to gather production database state.
 */
export interface DatabaseDumpDataService {
  /**
   * Get all History records for a project
   */
  getHistory(projectId: string): Promise<unknown[]>

  /**
   * Get Project record by ID
   */
  getProject(projectId: string): Promise<unknown>

  /**
   * Get all ProjectAttachment records for a project
   */
  getProjectAttachments(projectId: string): Promise<unknown[]>

  /**
   * Get ProjectShared record for a project
   */
  getProjectShared(projectId: string): Promise<unknown>
}

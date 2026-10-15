import * as fs from 'node:fs'
import * as path from 'node:path'

import { getNodeLocalScratchRoot } from './path.util'

/** Path segment constants shared with store path resolver and other consumers */
export const PATH_SEGMENTS = {
  storyLoader: 'story_loader',
  storyboard: 'storyboard',
  annotatedScriptJson: 'annotated_script.json',
  assets: 'assets',
  audio: 'audio',
  retrievalIntents: 'retrieval_intents',
  todoFile: 'todo.md',
  transcriptDir: 'transcript',
  transformedTranscriptJson: 'transformed_transcript.json',
  scriptFile: 'script.txt',
} as const

/**
 * Path resolver that reads path definitions from config file and provides path access functions
 */
class PathResolver {
  private readonly agents = ['director', 'story_loader', 'storyboard', 'video_crew', 'log']
  private readonly dirCache = 'cache'
  // private config: Config
  private projectRoot: string

  constructor() {
    this.projectRoot = this.getProjectRoot()
  }

  /**
   * Create directory if it doesn't exist
   */
  createDirectoryIfNotExists(dirPath: string): string {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
    return dirPath
  }

  /**
   * Get agent folder path - more generic version
   * @param agentName - Name of the agent
   * @param projectId - Project ID (required)
   * @param createIfNotExists - Whether to create the directory if it doesn't exist
   * @returns Full path to the agent folder
   */
  getAgentFolderPath(agentName: string, projectId: string, createIfNotExists = false): string {
    // Validate agent name
    if (!this.getAllAgents().includes(agentName)) {
      throw new Error(
        `Agent '${agentName}' not found in configuration. Available agents: ${this.getAllAgents().join(', ')}`,
      )
    }

    // Get agent path within the specified project
    const agentPath = path.join(this.getProjectPath(projectId), agentName)

    // Create directory if requested
    if (createIfNotExists) {
      this.createDirectoryIfNotExists(agentPath)
    }

    return agentPath
  }

  /**
   * Get path for specified agent within a project
   */
  getAgentPath(agentName: string, projectId: string): string {
    if (!this.getAllAgents().includes(agentName)) {
      throw new Error(`Agent ${agentName} not found in configuration`)
    }

    return path.join(this.getProjectPath(projectId), agentName)
  }

  /**
   * Get all agent folder paths for a project
   */
  getAllAgentFolderPaths(projectId: string, createIfNotExists = false): Record<string, string> {
    const agentPaths: Record<string, string> = {}

    for (const agentName of this.getAllAgents()) {
      agentPaths[agentName] = this.getAgentFolderPath(agentName, projectId, createIfNotExists)
    }

    return agentPaths
  }

  /**
   * Get list of all configured agents
   */
  getAllAgents(): string[] {
    return this.agents
  }

  /**
   * Get cache folder path
   */
  getCacheFolderPath(): string {
    return path.join(this.getStoragePath(), this.dirCache)
  }

  getHookFolderPath(projectId: string): string {
    return path.join(this.getProjectPath(projectId), 'hook')
  }

  /**
   * Get project path
   */
  getProjectPath(projectId: string): string {
    if (!projectId) {
      throw new Error('Project ID is required')
    }
    return path.join(this.getProjectsFolderPath(), projectId)
  }

  /**
   * Get project root directory
   */
  getProjectRootPath(): string {
    return this.projectRoot
  }

  /**
   * Get projects folder path
   */
  getProjectsFolderPath(): string {
    // Per-pod scratch always resolves under the node-local scratch
    // root.
    return getNodeLocalScratchRoot()
  }

  /**
   * Extract relative path after projectId from absolute path
   * @param absolutePath - The absolute file path
   * @param projectId - The project ID to find in the path
   * @returns Relative path after projectId, or empty string if projectId not found or at end
   * @example
   * // Input: "/home/u/workspace/test-project/folder1/folder2/test.md", "test-project"
   * // Output: "folder1/folder2/test.md"
   */
  getRelativePath(absolutePath: string, projectId: string): string {
    // Normalize the path to handle different OS path separators
    const normalizedPath = path.normalize(absolutePath)
    const pathParts = normalizedPath.split(path.sep)

    // Find the index of projectId in the path parts
    const projectIdIndex = pathParts.indexOf(projectId)

    if (projectIdIndex === -1) {
      throw new Error(`Project ID '${projectId}' not found in path: ${absolutePath}`)
    }

    // Check if projectId is at the end of the path
    if (projectIdIndex === pathParts.length - 1) {
      return ''
    }

    // Extract parts after projectId
    const relativeParts = pathParts.slice(projectIdIndex + 1)

    // Join with forward slashes for consistent output
    return relativeParts.join('/')
  }

  // Basic path functions
  /**
   * Get storage path
   */
  getStoragePath(): string {
    const configValue = 'tmp'
    const base = this.projectRoot
    return path.join(base, configValue)
  }

  public getStoryboardPath(projectId: string): string {
    return path.join(this.getProjectPath(projectId), PATH_SEGMENTS.storyboard)
  }

  public getStoryLoaderAssetAnnotatedScriptJsonPath(projectId: string): string {
    return path.join(this.getStoryLoaderPath(projectId), PATH_SEGMENTS.annotatedScriptJson)
  }

  public getStoryLoaderAssetsFolderPath(projectId: string): string {
    return path.join(this.getStoryLoaderPath(projectId), PATH_SEGMENTS.assets)
  }

  public getStoryLoaderAudioFolderPath(projectId: string): string {
    return path.join(this.getStoryLoaderPath(projectId), PATH_SEGMENTS.audio)
  }

  public getStoryLoaderPath(projectId: string): string {
    return path.join(this.getProjectPath(projectId), PATH_SEGMENTS.storyLoader)
  }

  public getStoryLoaderRetrievalIntentsFolderPath(projectId: string): string {
    return path.join(this.getStoryLoaderPath(projectId), PATH_SEGMENTS.retrievalIntents)
  }

  public getStoryLoaderTodoFilePath(projectId: string): string {
    return path.join(this.getStoryLoaderPath(projectId), PATH_SEGMENTS.todoFile)
  }

  public getStoryLoaderTransformedJsonFilePath(projectId: string): string {
    return path.join(
      this.getStoryLoaderPath(projectId),
      PATH_SEGMENTS.transcriptDir,
      PATH_SEGMENTS.transformedTranscriptJson,
    )
  }

  /**
   * Check if agent exists in configuration
   */
  hasAgent(agentName: string): boolean {
    return this.getAllAgents().includes(agentName)
  }

  /**
   * Get the project root directory
   */
  private getProjectRoot(): string {
    // Get current file directory (CommonJS compatible)
    let currentDir = __dirname

    // Search upward until finding the root directory containing pnpm-workspace.yaml
    while (path.dirname(currentDir) !== currentDir) {
      const configFile = path.join(currentDir, 'pnpm-workspace.yaml')
      if (fs.existsSync(configFile)) {
        return currentDir
      }
      currentDir = path.dirname(currentDir)
    }

    // If not found, use a reasonable fallback
    return path.resolve(currentDir, '../../../..')
  }
}

// Export typed instance
export const typedPathResolver = new PathResolver()

// Default export
export default typedPathResolver

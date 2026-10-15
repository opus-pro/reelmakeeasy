/** should be synced with libs/agent/src/agents/common/agent-aliases.ts */
export const AGENT_NAMES = {
  SCRIPT_WRITER: 'Scriptwriter',
  HOOK_EXPERT: 'Hook Designer',
  RESEARCHER: 'Researcher',
  STORYBOARD_ARTIST: 'Storyboard Artist',
  MOTION_DESIGNER: 'Motion Designer',
  DIRECTOR: 'Director',
  EDITOR: 'Editor',
} as const
export type AgentName = (typeof AGENT_NAMES)[keyof typeof AGENT_NAMES]

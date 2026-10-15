export const PRESET_PROMPTS = [
  {
    label: 'Regenerate the shot',
    value: 'Regenerate this shot, make it better by improving: [               ]',
  },
  {
    label: 'Fix text glitch',
    value: 'Fix [               ] to ensure it is clear, and spelled correctly.',
  },
  {
    label: 'Change camera angle',
    value:
      'Change the camera angle to:[               ](e.g. fast zoom in, camera follows,handheld...)',
  },
]

// Keep in sync with APPLY_NEW_KEYFRAME_PROMPTS in
// libs/agent/src/agents/common/regenerate/video/regenerate-transition.ts. The editor
// worker matches this string (lowercased + trimmed) to detect keyframe-apply regens;
// the match also appends the edited-keyframe ground-truth guard to the
// model prompt, so changing this copy silently drops that guard.
export const DEFAULT_PROMPT = 'Generate this shot with the new keyframe'

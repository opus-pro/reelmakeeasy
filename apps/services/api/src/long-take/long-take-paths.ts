// Canonical store paths for the reusable long-take artifacts a regenerate/
// restyle reads from the source project (mirrors the workflow's regenerate
// activity). Shared between long-take-regenerate.util (the retry-eligibility
// probe) and long-take-transition-slot-preflight (the slot-feasibility read)
// so both stay pointed at the same files.
export const LONG_TAKE_SHOT_PLAN_PATH = 'long_take/shot_plan.json'
export const LONG_TAKE_KEYFRAMES_PATH = 'long_take/keyframes.json'

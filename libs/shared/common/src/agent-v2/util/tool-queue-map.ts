/**
 * Task queue for the editor workflows. Story Mode runs on its own queues (see
 * `libs/story-mode-runtime/src/constants.ts`) and the final render on `render`.
 */

export const EDITOR_TASK_QUEUE = 'ao-editor'

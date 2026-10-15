// Logger call sites that predate the runtime rescue hook in
// libs/shared/common/src/logger/index.ts. Their surplus args are no longer dropped, so the
// @nx/workspace-logger-no-dropped-args rule is off for these files rather than rewriting
// them all in one sweep.
//
// Only ever shrink this list: when you move a call site to the merging-object form
// (logger.error({ error }, 'msg')), delete its entry in the same PR. Never add to it.
//
// These are glob patterns, not plain paths. Metacharacters in Next.js route segments are
// escaped, and a project that ships its own eslint.config.mjs is linted with that file's
// directory as the base path, so its entries are written project-relative behind a `**/`.
//
// Exported as a whole flat-config entry because eslint.config.mjs sits on the 800-line cap.
export const loggerDroppedArgsLegacyConfig = {
  files: [
    'apps/services/api/src/image-models/image-models.controller.ts',
    'apps/services/api/src/long-take/inpaint.service.ts',
    'apps/services/api/src/media/media.service.ts',
    'apps/services/api/src/project-scene/adaptor/parseSceneDataForCanvas.ts',
    'apps/services/api/src/projects/projects-lifecycle.util.ts',
    'apps/services/render/src/activities/video-concat.activities.ts',
    'apps/services/render/src/activities/video-render.activities.ts',
    'apps/services/render/src/workflows/video-concat.workflows.ts',
    'apps/services/render/src/workflows/video-render.workflows.ts',
    String.raw`apps/web/src/app/projects/\[projectId\]/editor/utils/media-data-manager/cache-manager.ts`,
    String.raw`apps/web/src/app/projects/\[projectId\]/editor/utils/media-data-manager/manager.ts`,
    String.raw`apps/web/src/app/projects/\[projectId\]/editor/utils/media-data-manager/request-queue.ts`,
    'apps/web/src/components/ongoing-projects/OngoingProjectsNotificationState.ts',
    'libs/shared/common/src/agent-v2/storage/project-store.ts',
    'libs/story-mode-runtime/src/activities/uip-v2/tools/select-auto-style.ts',
    'libs/story-mode-runtime/src/workflows/long-take/bgm-regenerate-workflow.ts',
    'libs/story-mode-runtime/src/workflows/long-take/bgm-remux-workflow.ts',
    'libs/story-mode-runtime/src/workflows/story-mode-3-playground/workflow.ts',
  ],
  name: 'reelmakeeasy/logger-dropped-args-legacy',
  rules: {
    '@nx/workspace-logger-no-dropped-args': 'off',
  },
}

/**
 * The `code` of the 404 `GET /api/project/:id/download-url` answers when the project's
 * delivered file is missing (never rendered, or gone). The editor's export renders on it;
 * any other 404 (no project, no lip-sync variant) still fails as before.
 */
export const VIDEO_NOT_RENDERED_ERROR_CODE = 'VIDEO_NOT_RENDERED'

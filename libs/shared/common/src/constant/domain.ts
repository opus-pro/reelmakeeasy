/** The local API. The web app reads NEXT_PUBLIC_API_ORIGIN to use another one. */
export const API_ORIGIN = {
  LOCAL: 'http://localhost:5017',
}

/** Where the local API serves projects' files (`<api>/api/files/projects`). */
export const FILE_ORIGIN = {
  LOCAL: `${API_ORIGIN.LOCAL}/api/files/projects`,
}

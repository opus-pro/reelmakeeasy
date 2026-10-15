export type ChatBoxFrontEndExtra = {
  // on for frontend, no store on api
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _feRaw?: any[]
  _feUpdatedAt?: string

  // this message is created from DB
  createdAt: string // "2025-07-08T12:31:15.461Z"
  updatedAt: string // "2025-07-08T12:31:15.461Z"
}

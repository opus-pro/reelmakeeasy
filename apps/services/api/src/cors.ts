import { INestApplication } from '@nestjs/common'

/**
 * The web app calls the API cross-origin, so the API allows the web app's own
 * origins, whatever NODE_ENV says: a production build on this computer is
 * served the same way as a dev server.
 */
export default function setCors(app: INestApplication<unknown>) {
  const allowedOrigins = webAppOrigins()
  app.enableCors({
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    optionsSuccessStatus: 200,
    origin: (origin?: string, callback?: (err: Error | null, allow?: boolean) => void) => {
      // No Origin header: same-origin or not from a browser. Any other origin gets no CORS
      // headers, so the browser keeps its response from the page.
      callback?.(null, !origin || allowedOrigins.has(origin))
    },
  })
}

/** The web app's origins on this computer: localhost and 127.0.0.1 on WEB_PORT (default 3000). */
function webAppOrigins(): Set<string> {
  const webPort = Number(process.env['WEB_PORT']) || 3000
  return new Set([`http://127.0.0.1:${webPort}`, `http://localhost:${webPort}`])
}

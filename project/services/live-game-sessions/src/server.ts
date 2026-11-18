import { createApp } from './app.ts'
import { openChannel } from './relay.ts'

const env = process.env
const jwtSecret = env.JWT_SECRET ?? ''
if (jwtSecret.length < 32) {
  console.error('JWT_SECRET must be set and at least 32 characters long')
  process.exit(1)
}

process.on('unhandledRejection', (reason) => console.error('Unhandled rejection', reason))

const port = Number(env.LGS_PORT ?? 3000)
createApp({
  jwtSecret,
  libraryUrl: env.LIBRARY_URL ?? 'http://localhost:8082',
  scoringUrl: env.SCORING_URL ?? 'http://localhost:8083',
  timeoutMs: Number(env.SERVICE_TIMEOUT_MS ?? 5000),
  openChannel,
}).listen(port, () => console.log(`Live Game Sessions listening on :${port}`))

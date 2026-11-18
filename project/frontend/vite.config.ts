import { networkInterfaces } from 'node:os'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const VIRTUAL = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|Loopback/i
const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/

function lanAddress() {
  return Object.entries(networkInterfaces())
    .filter(([name]) => !VIRTUAL.test(name))
    .flatMap(([, list]) => list ?? [])
    .find((a) => a.family === 'IPv4' && !a.internal && PRIVATE.test(a.address))?.address
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const accounts = env.VITE_ACCOUNTS_URL || 'http://localhost:8081'
  const proxy = {
    '/api/auth': accounts,
    '/api/accounts': accounts,
    '/api/quizzes': env.VITE_LIBRARY_URL || 'http://localhost:8082',
    '/api/games': env.VITE_SCORING_URL || 'http://localhost:8083',
    '/api/rooms': env.VITE_SESSIONS_URL || 'http://localhost:3000',
  }
  const lan = command === 'serve' ? lanAddress() : undefined
  const publicOrigin = env.VITE_PUBLIC_ORIGIN || (lan ? `http://${lan}:5173` : '')
  return {
    plugins: [react()],
    define: { __PUBLIC_ORIGIN__: JSON.stringify(publicOrigin.replace(/\/+$/, '')) },
    server: { host: true, port: 5173, strictPort: true, proxy },
    preview: { proxy },
  }
})

import { useEffect, useRef, useState } from 'react'
import Constants from 'expo-constants'
import { connect, type IttySocketOptions } from 'itty-sockets'
import { createResync, EVENT_TYPES, messageFor, NETWORK, type LiveEvent, type Snapshot } from './core'

const devHost = Constants.expoConfig?.hostUri?.split(':')[0] || 'localhost'
export const LGS_URL = process.env.EXPO_PUBLIC_LGS_URL || `http://${devHost}:3000`

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string) {
    super(messageFor(code))
    this.status = status
    this.code = code
  }
}

export const roomPath = (code: string) => `/api/rooms/${encodeURIComponent(code)}`

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(LGS_URL + path, {
      method,
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, NETWORK)
  }
  const data = await res.json().catch(() => null)
  if (res.ok) return data as T
  throw new ApiError(res.status, typeof data?.code === 'string' ? data.code : '')
}

export type LinkState = 'connecting' | 'open' | 'reconnecting'

export function useLive(channel: string | undefined, joinKey: string, as: string, onEvent: (e: LiveEvent) => void, onOpen: () => void) {
  const handler = useRef({ onEvent, onOpen })
  const [state, setState] = useState<LinkState>('connecting')
  useEffect(() => {
    handler.current = { onEvent, onOpen }
  })
  useEffect(() => {
    if (!channel) return
    let left = false
    let attempt = 0
    const socket = connect(channel, { joinKey, as, announce: true } as IttySocketOptions)
    for (const type of EVENT_TYPES) socket.on(type, (e) => left || handler.current.onEvent(e as unknown as LiveEvent))
    socket.on('open', () => {
      if (left) return
      attempt = 0
      setState('open')
      handler.current.onOpen()
    })
    socket.on('close', () => {
      if (left) return
      setState('reconnecting')
      setTimeout(() => left || socket.open(), Math.random() * Math.min(30000, 1000 * 2 ** attempt++))
    })
    return () => {
      left = true
      socket.close()
    }
  }, [channel, joinKey, as])
  return state
}

export function useResync(fetchSnapshot: () => Promise<Snapshot | null>, apply: (s: Snapshot) => void, onEvent: (e: LiveEvent) => void) {
  const latest = useRef({ fetchSnapshot, apply, onEvent })
  useEffect(() => {
    latest.current = { fetchSnapshot, apply, onEvent }
  })
  const [sync] = useState(() =>
    createResync(
      () => latest.current.fetchSnapshot(),
      (s) => latest.current.apply(s),
      (e) => latest.current.onEvent(e),
    ),
  )
  return sync
}

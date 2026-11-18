import { useCallback, useEffect, useState } from 'react'

export const UNAVAILABLE = 'Service unavailable, try again'

const BY_CODE: Record<string, string> = {
  ROOM_NOT_FOUND: 'There is no room with this code. Check the code and try again.',
  ROOM_NOT_JOINABLE: 'This game has already started or ended, so it is not accepting new players.',
  NICKNAME_TAKEN: 'Someone in this room already uses that nickname. Please pick another one.',
  ROOM_FULL: 'This room is full (100 players).',
  QUESTION_CLOSED: 'Answering is closed for this question.',
  ALREADY_ANSWERED: 'You already answered this question. Your first answer counts.',
  NOT_IN_ROOM: 'You are no longer a player in this room. Please join again.',
  QUIZ_NOT_FOUND: 'This quiz no longer exists.',
  QUIZ_NOT_READY: 'This quiz is not ready yet. Approve between 1 and 10 questions first.',
  LIBRARY_UNAVAILABLE: 'The question library is unavailable right now. Please try again.',
  RELAY_UNAVAILABLE: 'The live connection service is unavailable right now. Please try again.',
  SCORING_UNAVAILABLE: 'Scoring is unavailable right now. Nothing was lost, please try again.',
  UNAUTHORIZED: 'Your login has expired. Please log in again.',
}

const BY_STATUS: Record<number, string> = {
  400: 'Some of the information is not valid. Please check it and try again.',
  401: 'Your login has expired. Please log in again.',
  403: 'You are not allowed to do that.',
  404: 'We could not find that. It may have been deleted.',
  409: 'That conflicts with the current state. Please refresh and try again.',
  422: 'That is not allowed for this quiz.',
}

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function friendly(status: number, problem: { code?: unknown; detail?: unknown } | null): string {
  const code = typeof problem?.code === 'string' ? problem.code : ''
  if (BY_CODE[code]) return BY_CODE[code]
  const detail = typeof problem?.detail === 'string' ? problem.detail.trim() : ''
  if (status >= 500 || status === 0) return UNAVAILABLE
  if (detail && detail !== 'Invalid request content.' && detail.length < 300) return detail.endsWith('.') ? detail : detail + '.'
  return BY_STATUS[status] ?? UNAVAILABLE
}

export const errorText = (e: unknown) => (e instanceof ApiError ? e.message : UNAVAILABLE)

export function load<T>(key: string): T | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null') as T | null
  } catch {
    return null
  }
}

export function save(key: string, value: unknown) {
  try {
    if (value == null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, JSON.stringify(value))
  } catch {}
  dispatchEvent(new Event('qr:save'))
}

export const getToken = () => load<string>('qr.token')

export const go = (path: string) => {
  location.hash = path
}

export async function api<T>(method: string, path: string, body?: unknown, auth = true, extra: Record<string, string> = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json, application/problem+json', ...extra }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = auth ? getToken() : null
  if (token) headers.Authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError(0, 'NETWORK', UNAVAILABLE)
  }
  const data = await res.json().catch(() => null)
  if (res.ok) return data as T
  if (res.status === 401 && auth) {
    save('qr.token', null)
    go('/login')
  }
  throw new ApiError(res.status, typeof data?.code === 'string' ? data.code : '', friendly(res.status, data))
}

export function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(
    () =>
      api<T>('GET', path).then(
        (value) => {
          setData(value)
          setError('')
        },
        (e) => setError(errorText(e)),
      ),
    [path],
  )
  useEffect(() => {
    reload()
  }, [reload])
  return { data, error, reload }
}

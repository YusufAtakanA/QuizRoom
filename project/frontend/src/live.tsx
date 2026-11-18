import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { connect, type IttySocketOptions } from 'itty-sockets'

export type Participant = { participantId: string; nickname: string; connected: boolean }
export type Standing = { playerId: string; nickname: string; score: number; rank: number }
export type OpenQuestion = { index: number; text: string; options: string[] }
export type Reveal = { index: number; correctIndex: number; explanation: string | null }
export type Count = { index: number; submitted: number; total: number }

export type LiveEvent = (
  | { type: 'participants:update'; participants: Participant[] }
  | { type: 'game:started'; questionCount: number }
  | ({ type: 'question:opened' } & OpenQuestion)
  | ({ type: 'answers:count' } & Count)
  | ({ type: 'question:closed' } & Reveal)
  | { type: 'leaderboard:update'; leaderboard: Standing[] }
  | { type: 'game:ended'; scoreboard: Standing[] }
) & { eventId?: number }

export type Snapshot =
  | { status: string; eventId?: undefined }
  | {
      status: 'LOBBY' | 'IN_PROGRESS' | 'FINISHED'
      eventId: number
      questionCount: number
      participants: Participant[]
      question: OpenQuestion | null
      open: boolean
      answers: Count | null
      reveal: Reveal | null
      leaderboard: Standing[]
      scoreboard: Standing[] | null
      myAnswer?: number | null
    }

const TYPES = [
  'participants:update',
  'game:started',
  'question:opened',
  'answers:count',
  'question:closed',
  'leaderboard:update',
  'game:ended',
]

export function useLive(
  channel: string | undefined,
  joinKey: string | undefined,
  as: string | undefined,
  onEvent: (event: LiveEvent) => void,
  onOpen: () => void,
) {
  const handler = useRef({ onEvent, onOpen })
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    handler.current = { onEvent, onOpen }
  })
  useEffect(() => {
    if (!channel || !joinKey) return
    let left = false
    let attempt = 0
    const options = as ? { joinKey, as, announce: true } : { joinKey }
    const socket = connect(channel, options as IttySocketOptions)
    for (const type of TYPES) socket.on(type, (event) => left || handler.current.onEvent(event as unknown as LiveEvent))
    socket.on('open', () => {
      if (left) return
      attempt = 0
      setConnected(true)
      handler.current.onOpen()
    })
    socket.on('close', () => {
      if (left) return
      setConnected(false)
      setTimeout(() => left || socket.open(), Math.random() * Math.min(30000, 1000 * 2 ** attempt++))
    })
    return () => {
      left = true
      setConnected(false)
      socket.close()
    }
  }, [channel, joinKey, as])
  return connected
}

export function useResync(
  fetchSnapshot: () => Promise<Snapshot | null>,
  apply: (snapshot: Snapshot) => void,
  onEvent: (event: LiveEvent) => void,
) {
  const latest = useRef({ fetchSnapshot, apply, onEvent })
  useEffect(() => {
    latest.current = { fetchSnapshot, apply, onEvent }
  })
  const [sync] = useState(() => {
    let last = 0
    const snapshot = (again = true) =>
      void latest.current.fetchSnapshot().then((s) => {
        if (!s) return
        if (s.eventId === undefined) return latest.current.apply(s)
        if (s.eventId >= last) {
          last = s.eventId
          latest.current.apply(s)
        } else if (again) snapshot(false)
      })
    const event = (e: LiveEvent) => {
      if (typeof e.eventId !== 'number' || e.eventId <= last) return
      const gap = e.eventId > last + 1
      last = e.eventId
      latest.current.onEvent(e)
      if (gap) snapshot()
    }
    return { snapshot: () => snapshot(), event }
  })
  return sync
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'))

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export type Tone = 'live' | 'wait' | 'done' | 'off' | 'ready' | 'plain'

export function Capsule({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`capsule ${tone}`}>{children}</span>
}

export function BusyLabel({ busy, idle, active }: { busy: boolean; idle: string; active: string }) {
  return (
    <span className="busy-label" data-busy={busy || undefined}>
      <span>{idle}</span>
      <span>
        <span className="spinner" aria-hidden="true" />
        {active}
      </span>
    </span>
  )
}

export function Skeleton({ count = 3, label = 'Loading…', kind = 'cards' }: { count?: number; label?: string; kind?: 'cards' | 'row' }) {
  return (
    <div className={`skeleton ${kind}`}>
      <p role="status" className="visually-hidden">
        {label}
      </p>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bone" aria-hidden="true" />
      ))}
    </div>
  )
}

export function People({ participants, me, empty = 'No players yet.' }: { participants: Participant[]; me?: string; empty?: ReactNode }) {
  if (participants.length === 0) return <p className="muted">{empty}</p>
  const list = me ? [...participants].sort((a, b) => Number(b.participantId === me) - Number(a.participantId === me)) : participants
  return (
    <ul className="people">
      {list.map((p, i) => (
        <li key={p.participantId} className={p.connected ? 'online' : 'offline'} style={{ '--i': i } as CSSProperties} title={p.nickname}>
          <span className="dot" aria-hidden="true" />
          <span className="nick">{p.nickname}</span>
          {p.participantId === me && <span className="you">You</span>}
          {p.connected ? <span className="visually-hidden">connected</span> : <span className="away">away</span>}
        </li>
      ))}
    </ul>
  )
}

export type Moves = Map<string, { places: number; shift: number }>

export function useMoves(rows: Standing[]) {
  const [state, setState] = useState<{ rows: Standing[]; moves: Moves }>({ rows, moves: new Map() })
  if (rows !== state.rows) {
    const before = new Map(state.rows.map((r, i) => [r.playerId, { rank: r.rank, index: i }]))
    const changed = rows.length !== state.rows.length || rows.some((r, i) => before.get(r.playerId)?.rank !== r.rank || before.get(r.playerId)?.index !== i)
    if (changed) {
      const moves: Moves = new Map()
      rows.forEach((r, i) => {
        const b = before.get(r.playerId)
        if (b && (b.rank !== r.rank || b.index !== i)) moves.set(r.playerId, { places: b.rank - r.rank, shift: b.index - i })
      })
      setState({ rows, moves })
    }
  }
  return state.moves
}

export function Board({ rows, me, title, moves, limit }: { rows: Standing[]; me?: string; title: string; moves?: Moves; limit?: number }) {
  const body = useRef<HTMLTableSectionElement>(null)
  const shown = limit ? rows.slice(0, limit) : rows

  useLayoutEffect(() => {
    const tbody = body.current
    if (!tbody || !moves?.size || reducedMotion() || !tbody.animate) return
    const css = getComputedStyle(tbody)
    const easing = css.getPropertyValue('--ease-spring').trim() || 'ease-out'
    const tint = css.getPropertyValue('--accent-tint').trim()
    for (const tr of Array.from(tbody.rows)) {
      const move = moves.get(tr.dataset.id ?? '')
      if (!move) continue
      const visual = tr.getBoundingClientRect().top
      tr.getAnimations().forEach((a) => a.cancel())
      const rect = tr.getBoundingClientRect()
      const dy = move.shift * rect.height + visual - rect.top
      if (Math.abs(dy) > 1) tr.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 575, easing })
      if (move.places > 0 && tint) tr.animate([{ backgroundColor: tint }, { backgroundColor: 'transparent' }], { duration: 600, easing: 'ease-out' })
    }
  }, [moves])

  return (
    <table className="board">
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">Rank</th>
          <th scope="col">Player</th>
          <th scope="col">Score</th>
        </tr>
      </thead>
      <tbody ref={body}>
        {shown.map((r) => {
          const move = moves?.get(r.playerId)
          return (
            <tr key={r.playerId} data-id={r.playerId} className={r.playerId === me ? 'me' : undefined} aria-current={r.playerId === me || undefined}>
              <td>
                {ordinal(r.rank)}
                {move && move.places !== 0 && (
                  <span className={move.places > 0 ? 'delta up' : 'delta down'}>
                    <span aria-hidden="true">
                      {move.places > 0 ? '▲' : '▼'}
                      {Math.abs(move.places)}
                    </span>
                    <span className="visually-hidden">
                      {' '}
                      {move.places > 0 ? 'up' : 'down'} {plural(Math.abs(move.places), 'place')}
                    </span>
                  </span>
                )}
              </td>
              <td>
                {r.nickname}
                {r.playerId === me && <span className="you"> You</span>}
              </td>
              <td>{r.score}</td>
            </tr>
          )
        })}
        {rows.length > shown.length && (
          <tr className="more">
            <td colSpan={3}>and {rows.length - shown.length} more</td>
          </tr>
        )}
        {rows.length === 0 && (
          <tr>
            <td colSpan={3} className="muted">
              No players.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

export function Podium({ rows, animate }: { rows: Standing[]; animate: boolean }) {
  const top: Standing[][] = []
  for (const r of rows) {
    if (r.rank > 3) break
    if (top.at(-1)?.[0].rank === r.rank) top.at(-1)!.push(r)
    else top.push([r])
  }
  if (top.length === 0) return null
  const order = [top[1], top[0], top[2]].filter((g): g is Standing[] => g !== undefined)
  return (
    <div className={animate ? 'podium animate' : 'podium'} aria-hidden="true">
      {order.map((group) => {
        const [first] = group
        const names = group.map((r) => r.nickname)
        return (
          <div
            key={first.rank}
            className={`podium-col r${Math.min(first.rank, 3)}`}
            style={{ '--d': `${(top.length - 1 - top.indexOf(group)) * 140}ms` } as CSSProperties}
          >
            <div className="podium-name">
              <strong>{names.length > 3 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ')}</strong>
              <span>{plural(first.score, 'point')}</span>
            </div>
            <div className="podium-block">
              {ordinal(first.rank)}
              {group.length > 1 && <small>{plural(group.length, 'player')}</small>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export const LETTERS = ['A', 'B', 'C', 'D']
export const SHAPES = ['▲', '◆', '●', '■']

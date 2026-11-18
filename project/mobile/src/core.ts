export type Player = { roomCode: string; nickname: string; sessionId: string; participantId: string; channel: string; joinKey: string }
export type Participant = { participantId: string; nickname: string; connected: boolean }
export type Standing = { playerId: string; nickname: string; score: number; rank: number }
export type OpenQuestion = { index: number; text: string; options: string[] }
export type Reveal = { index: number; correctIndex: number; explanation: string | null }

export type LiveEvent = (
  | { type: 'participants:update'; participants: Participant[] }
  | { type: 'game:started'; questionCount: number }
  | ({ type: 'question:opened' } & OpenQuestion)
  | { type: 'answers:count'; index: number; submitted: number; total: number }
  | ({ type: 'question:closed' } & Reveal)
  | { type: 'leaderboard:update'; leaderboard: Standing[] }
  | { type: 'game:ended'; scoreboard: Standing[] }
) & { eventId?: number }

export type FullSnapshot = {
  status: 'LOBBY' | 'IN_PROGRESS' | 'FINISHED'
  eventId: number
  questionCount: number
  participants: Participant[]
  question: OpenQuestion | null
  open: boolean
  reveal: Reveal | null
  leaderboard: Standing[]
  scoreboard: Standing[] | null
  myAnswer?: number | null
}
export type Snapshot = FullSnapshot | { status: string; eventId?: undefined }

export const EVENT_TYPES = ['participants:update', 'game:started', 'question:opened', 'answers:count', 'question:closed', 'leaderboard:update', 'game:ended']

export function parseCode(text: string): string | null {
  const match = /\/join\/([A-Za-z0-9]{6})/.exec(text)
  const code = match ? match[1] : /^[A-Za-z0-9]{6}$/.test(text.trim()) ? text.trim() : null
  return code ? code.toUpperCase() : null
}

export function createResync(
  fetchSnapshot: () => Promise<Snapshot | null>,
  apply: (snapshot: Snapshot) => void,
  onEvent: (event: LiveEvent) => void,
) {
  let last = 0
  const snapshot = (again = true): Promise<void> =>
    fetchSnapshot().then((s) => {
      if (!s) return
      if (s.eventId === undefined) return apply(s)
      if (s.eventId >= last) {
        last = s.eventId
        apply(s)
      } else if (again) return snapshot(false)
    })
  const event = (e: LiveEvent) => {
    if (typeof e.eventId !== 'number' || e.eventId <= last) return
    const gap = e.eventId > last + 1
    last = e.eventId
    onEvent(e)
    if (gap) void snapshot()
  }
  return { snapshot: () => snapshot(), event }
}

export const NETWORK = 'NETWORK'

const MESSAGES: Record<string, string> = {
  NETWORK: "Can't reach the game server. Make sure your phone is on the same Wi-Fi as the host's computer.",
  ROOM_NOT_FOUND: 'There is no room with this code. Check the code and try again.',
  ROOM_NOT_JOINABLE: 'This game has already started or ended, so it is not accepting new players.',
  NICKNAME_TAKEN: 'Someone in this room already uses that nickname. Please pick another one.',
  ROOM_FULL: 'This room is full.',
  INVALID_REQUEST: 'Please check the room code and nickname and try again.',
  QUESTION_CLOSED: 'Answering is closed for this question.',
  ALREADY_ANSWERED: 'You already answered this question. Your first answer counts.',
  NOT_IN_ROOM: 'You are no longer a player in this room. Please join again.',
}

export const messageFor = (code: string) => MESSAGES[code] ?? 'Something went wrong. Please try again.'

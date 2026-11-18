import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import type { Channel } from './relay.ts'

export type Question = { text: string; options: string[]; correctIndex: number; explanation: string | null }
export type Player = { participantId: string; nickname: string; sessionId: string; links: number }
export type Leaderboard = { index: number; leaderboard: unknown[] }

export type Room = {
  roomId: string
  code: string
  hostId: string
  channel: string
  joinKey: string
  sendKey: string
  quizTitle: string
  questions: Question[]
  status: 'LOBBY' | 'IN_PROGRESS' | 'FINISHED'
  players: Player[]
  current: number
  open: boolean
  answers: Map<string, number>[]
  scored: Set<number>
  endRequested: boolean
  touched: number
  seq: number
  leaderboard: unknown[]
  relay?: Channel
  closing?: Promise<Leaderboard>
  ending?: Promise<unknown>
  results?: { scoreboard: unknown[] }
}

export class Problem extends Error {
  status: number
  code: string
  constructor(status: number, code: string, detail: string) {
    super(detail)
    this.status = status
    this.code = code
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const MAX_PLAYERS = 100

export const secret = () => randomBytes(24).toString('base64url')

export function newCode(taken: (code: string) => boolean): string {
  for (;;) {
    let code = ''
    for (let i = 0; i < 6; i++) code += ALPHABET[randomInt(ALPHABET.length)]
    if (!taken(code)) return code
  }
}

export function createRoom(hostId: string, quizTitle: string, questions: Question[]): Room {
  const roomId = randomUUID()
  return {
    roomId,
    code: '',
    hostId,
    channel: 'quizroom-' + roomId,
    joinKey: secret(),
    sendKey: secret(),
    quizTitle,
    questions,
    status: 'LOBBY',
    players: [],
    current: -1,
    open: false,
    answers: questions.map(() => new Map()),
    scored: new Set(),
    endRequested: false,
    touched: Date.now(),
    seq: 0,
    leaderboard: [],
  }
}

const invalid = (detail: string) => new Problem(409, 'INVALID_STATE', detail)

const unscored = (room: Room) => room.current >= 0 && !room.open && !room.scored.has(room.current)

function notEnding(room: Room) {
  if (room.endRequested) throw invalid('The game is ending; retry end to finish it')
}

export function addPlayer(room: Room, nickname: string): Player {
  if (room.status !== 'LOBBY' || room.endRequested) {
    throw new Problem(409, 'ROOM_NOT_JOINABLE', 'This room is no longer accepting players')
  }
  const lower = nickname.toLowerCase()
  if (room.players.some((p) => p.nickname.toLowerCase() === lower)) {
    throw new Problem(409, 'NICKNAME_TAKEN', 'This nickname is already taken in this room')
  }
  if (room.players.length >= MAX_PLAYERS) throw new Problem(409, 'ROOM_FULL', 'This room is full')
  const player = { participantId: randomUUID(), nickname, sessionId: secret(), links: 0 }
  room.players.push(player)
  return player
}

export function start(room: Room) {
  notEnding(room)
  if (room.status !== 'LOBBY') throw invalid('The game can only be started from the lobby')
  room.status = 'IN_PROGRESS'
}

export function openQuestion(room: Room): number {
  notEnding(room)
  if (room.status !== 'IN_PROGRESS') throw invalid('The game is not in progress')
  if (room.open) throw invalid('A question is already open')
  if (unscored(room)) throw invalid('The last question is not scored yet; close it again to retry scoring')
  if (room.current + 1 >= room.questions.length) throw invalid('There are no questions left')
  room.current++
  room.open = true
  return room.current
}

export function closeQuestion(room: Room): number {
  if (room.open) {
    room.open = false
    return room.current
  }
  if (unscored(room)) return room.current
  throw invalid('No question is open and nothing is waiting to be scored')
}

export function submitAnswer(room: Room, sessionId: string, optionIndex: number) {
  const player = room.players.find((p) => p.sessionId === sessionId)
  if (!player) throw new Problem(403, 'NOT_IN_ROOM', 'This session is not a player in this room')
  if (!room.open) throw new Problem(409, 'QUESTION_CLOSED', 'No question is open for answers')
  const answers = room.answers[room.current]
  if (answers.has(player.participantId)) {
    throw new Problem(409, 'ALREADY_ANSWERED', 'You already answered this question')
  }
  answers.set(player.participantId, optionIndex)
  return { index: room.current, submitted: answers.size, total: room.players.length }
}

export function requestEnd(room: Room) {
  if (room.open) throw invalid('Close the open question before ending the game')
  if (unscored(room)) throw invalid('The last question is not scored yet; close it again to retry scoring')
  room.endRequested = true
}

export const participants = (room: Room) =>
  room.players.map((p) => ({ participantId: p.participantId, nickname: p.nickname, connected: p.links > 0 }))

export const scoringPlayers = (room: Room) =>
  room.players.map((p) => ({ playerId: p.participantId, nickname: p.nickname }))

export function snapshot(room: Room, player?: Player) {
  const index = room.current
  const question = room.questions[index]
  const mine = player && { myAnswer: question ? room.answers[index].get(player.participantId) ?? null : null }
  return {
    ...mine,
    status: room.status,
    eventId: room.seq,
    questionCount: room.questions.length,
    participants: participants(room),
    question: question ? { index, text: question.text, options: question.options } : null,
    open: room.open,
    answers: question ? { index, submitted: room.answers[index].size, total: room.players.length } : null,
    reveal: question && room.scored.has(index) ? { index, correctIndex: question.correctIndex, explanation: question.explanation } : null,
    leaderboard: room.leaderboard,
    scoreboard: room.status === 'FINISHED' ? room.results?.scoreboard ?? null : null,
  }
}

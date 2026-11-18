import express, { type ErrorRequestHandler, type Request, type RequestHandler, type Response } from 'express'
import { STATUS_CODES } from 'node:http'
import { jwtVerify } from 'jose'
import type { Channel, OpenChannel } from './relay.ts'
import { callService } from './services.ts'
import {
  Problem,
  addPlayer,
  closeQuestion,
  createRoom,
  newCode,
  openQuestion,
  participants,
  requestEnd,
  scoringPlayers,
  snapshot,
  start,
  submitAnswer,
  type Question,
  type Room,
} from './rooms.ts'

export type Deps = {
  jwtSecret: string
  libraryUrl: string
  scoringUrl: string
  timeoutMs: number
  openChannel: OpenChannel
  roomTtlMs?: number
}

const ISSUER = 'quizroom-accounts'
const AUDIENCE = 'quizroom-sessions'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const badRequest = (detail: string) => new Problem(400, 'INVALID_REQUEST', detail)
const scoringDown = () => new Problem(503, 'SCORING_UNAVAILABLE', 'Scoring is unavailable; try again')

const isQuestion = (q: any): q is Question =>
  typeof q?.text === 'string' &&
  Array.isArray(q.options) &&
  q.options.length === 4 &&
  q.options.every((o: unknown) => typeof o === 'string') &&
  Number.isInteger(q.correctIndex) &&
  q.correctIndex >= 0 &&
  q.correctIndex <= 3 &&
  (q.explanation == null || typeof q.explanation === 'string')

const isSnapshot = (s: any) =>
  typeof s?.title === 'string' && Array.isArray(s.questions) && s.questions.length > 0 && s.questions.every(isQuestion)

const fields = (req: Request): Record<string, unknown> =>
  req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}

export function createApp(deps: Deps) {
  const key = new TextEncoder().encode(deps.jwtSecret)
  const rooms = new Map<string, Room>()
  const roomTtlMs = deps.roomTtlMs ?? 4 * 60 * 60 * 1000
  const app = express()
  app.use(express.json())

  const hostIdOf = async (authorization = '') => {
    const token = /^Bearer (\S+)$/.exec(authorization)?.[1] ?? ''
    try {
      const { sub } = (await jwtVerify(token, key, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE })).payload
      return typeof sub === 'string' && sub ? sub : undefined
    } catch {}
  }

  const host: RequestHandler = async (req, res, next) => {
    const sub = await hostIdOf(req.headers.authorization)
    if (!sub) return next(new Problem(401, 'UNAUTHORIZED', 'A valid host token is required'))
    res.locals.hostId = sub
    next()
  }

  const find = (req: Request, hostId?: string) => {
    const room = rooms.get(String(req.params.code).toUpperCase())
    if (!room || (hostId && room.hostId !== hostId)) throw new Problem(404, 'ROOM_NOT_FOUND', 'No room with this code')
    room.touched = Date.now()
    return room
  }

  const owned = (req: Request, res: Response) => find(req, res.locals.hostId)

  const sweep = () => {
    const now = Date.now()
    for (const [code, room] of rooms) {
      if (now - room.touched < roomTtlMs) continue
      rooms.delete(code)
      room.relay?.close()
    }
  }

  const publish = (room: Room, type: string, payload: object) =>
    room.relay?.publish(type, { version: 1, eventId: ++room.seq, ...payload })

  const presence = (room: Room, alias: string, delta: number) => {
    const player = room.players.find((p) => p.participantId === alias)
    if (!player) return
    player.links = Math.max(0, player.links + delta)
    publish(room, 'participants:update', { participants: participants(room) })
  }

  async function connectRelay(room: Room): Promise<Channel> {
    const pending = deps.openChannel({
      channel: room.channel,
      joinKey: room.joinKey,
      sendKey: room.sendKey,
      onJoin: (alias) => presence(room, alias, 1),
      onLeave: (alias) => presence(room, alias, -1),
    })
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(reject, deps.timeoutMs)
    })
    try {
      return await Promise.race([pending, timeout])
    } catch {
      pending.then((channel) => channel.close(), () => {})
      throw new Problem(503, 'RELAY_UNAVAILABLE', 'The live relay is unavailable')
    } finally {
      clearTimeout(timer)
    }
  }

  async function scoreClosed(room: Room, auth: string) {
    const index = closeQuestion(room)
    const question = room.questions[index]
    const answers = [...room.answers[index]].map(([playerId, optionIndex]) => ({ playerId, optionIndex }))
    const reply = await callService(
      'POST',
      `${deps.scoringUrl}/api/games/${room.roomId}/questions/${index}/score`,
      auth,
      deps.timeoutMs,
      { quizTitle: room.quizTitle, correctIndex: question.correctIndex, participants: scoringPlayers(room), answers },
    )
    if (!reply?.ok || !Array.isArray(reply.body?.leaderboard)) throw scoringDown()
    room.scored.add(index)
    room.leaderboard = reply.body.leaderboard
    publish(room, 'question:closed', { index, correctIndex: question.correctIndex, explanation: question.explanation })
    publish(room, 'leaderboard:update', { leaderboard: reply.body.leaderboard })
    return { index, leaderboard: reply.body.leaderboard }
  }

  async function finish(room: Room, auth: string) {
    requestEnd(room)
    const reply = await callService('POST', `${deps.scoringUrl}/api/games/${room.roomId}/finish`, auth, deps.timeoutMs, {
      quizTitle: room.quizTitle,
      participants: scoringPlayers(room),
    })
    if (!reply?.ok || !Array.isArray(reply.body?.scoreboard)) throw scoringDown()
    room.status = 'FINISHED'
    room.results = reply.body
    publish(room, 'game:ended', { scoreboard: reply.body.scoreboard })
    room.relay?.close()
    return reply.body
  }

  app.post('/api/rooms', host, async (req, res) => {
    const { quizId } = fields(req)
    if (typeof quizId !== 'string' || !UUID.test(quizId)) throw badRequest('quizId must be a quiz id (UUID)')
    const auth = req.headers.authorization ?? ''
    const reply = await callService('GET', `${deps.libraryUrl}/api/quizzes/${quizId}/snapshot`, auth, deps.timeoutMs)
    if (reply?.status === 404) throw new Problem(404, 'QUIZ_NOT_FOUND', 'Quiz not found')
    if (reply?.status === 409) throw new Problem(409, 'QUIZ_NOT_READY', 'The quiz needs 1 to 10 approved questions')
    if (reply?.status === 400) throw badRequest('Invalid quiz id')
    if (!reply?.ok || !isSnapshot(reply.body)) {
      throw new Problem(503, 'LIBRARY_UNAVAILABLE', 'Question Library is unavailable; try again')
    }
    sweep()
    const room = createRoom(res.locals.hostId, reply.body.title, reply.body.questions)
    room.relay = await connectRelay(room)
    room.code = newCode((code) => rooms.has(code))
    rooms.set(room.code, room)
    res.status(201).json({ roomId: room.roomId, roomCode: room.code, channel: room.channel, joinKey: room.joinKey })
  })

  app.post('/api/rooms/:code/start', host, (req, res) => {
    const room = owned(req, res)
    start(room)
    publish(room, 'game:started', { questionCount: room.questions.length })
    res.json({ status: room.status })
  })

  app.post('/api/rooms/:code/open-question', host, (req, res) => {
    const room = owned(req, res)
    const index = openQuestion(room)
    const { text, options } = room.questions[index]
    publish(room, 'question:opened', { index, text, options })
    res.json({ index })
  })

  app.post('/api/rooms/:code/close-question', host, async (req, res) => {
    const room = owned(req, res)
    room.closing ??= scoreClosed(room, req.headers.authorization ?? '').finally(() => {
      room.closing = undefined
    })
    res.json(await room.closing)
  })

  app.post('/api/rooms/:code/end', host, async (req, res) => {
    const room = owned(req, res)
    if (room.status === 'FINISHED') return void res.json(room.results)
    room.ending ??= finish(room, req.headers.authorization ?? '').finally(() => {
      room.ending = undefined
    })
    res.json(await room.ending)
  })

  app.get('/api/rooms/:code', async (req, res) => {
    const room = find(req)
    const sessionId = req.headers['x-session-id']
    const player = typeof sessionId === 'string' ? room.players.find((p) => p.sessionId === sessionId) : undefined
    if (player) return void res.json(snapshot(room, player))
    if ((await hostIdOf(req.headers.authorization)) === room.hostId) return void res.json(snapshot(room))
    res.json({ status: room.status })
  })

  app.post('/api/rooms/:code/players', (req, res) => {
    const room = find(req)
    const { nickname } = fields(req)
    const name = typeof nickname === 'string' ? nickname.trim() : ''
    if (name.length < 1 || name.length > 20) throw badRequest('nickname must be 1 to 20 characters')
    const player = addPlayer(room, name)
    publish(room, 'participants:update', { participants: participants(room) })
    res.status(201).json({
      sessionId: player.sessionId,
      participantId: player.participantId,
      channel: room.channel,
      joinKey: room.joinKey,
    })
  })

  app.post('/api/rooms/:code/answers', (req, res) => {
    const room = find(req)
    const { sessionId, optionIndex } = fields(req)
    if (typeof sessionId !== 'string' || !sessionId) throw badRequest('sessionId is required')
    if (typeof optionIndex !== 'number' || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3) {
      throw badRequest('optionIndex must be an integer from 0 to 3')
    }
    const count = submitAnswer(room, sessionId, optionIndex)
    publish(room, 'answers:count', count)
    res.json({ accepted: true, index: count.index })
  })

  app.use((_req, _res, next) => next(new Problem(404, 'NOT_FOUND', 'No such endpoint')))

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    let problem: Problem
    if (err instanceof Problem) problem = err
    else if (err?.status >= 400 && err.status < 500) problem = badRequest('Malformed request body')
    else {
      console.error(err)
      problem = new Problem(500, 'INTERNAL_ERROR', 'Unexpected error')
    }
    res
      .status(problem.status)
      .type('application/problem+json')
      .send(
        JSON.stringify({
          type: 'about:blank',
          title: STATUS_CODES[problem.status],
          status: problem.status,
          detail: problem.message,
          code: problem.code,
        }),
      )
  }
  app.use(onError)

  return app
}

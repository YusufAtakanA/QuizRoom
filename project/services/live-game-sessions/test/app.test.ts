import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { SignJWT } from 'jose'
import { createApp } from '../src/app.ts'
import type { ChannelOptions } from '../src/relay.ts'

const SECRET = 'test-secret-test-secret-test-secret-123'
const TIMEOUT = 300
const QUIZ = randomUUID()

const questions = () => [
  { text: 'Q1?', options: ['a', 'b', 'c', 'd'], correctIndex: 1, explanation: 'because b' },
  { text: 'Q2?', options: ['e', 'f', 'g', 'h'], correctIndex: 2, explanation: null },
]

type Mode = 'ok' | 'fail' | 'slow' | 'down'
const library = { mode: 'ok' as Mode, status: 200, title: 'Quiz', questions: questions(), calls: [] as string[] }
const scoring = {
  mode: 'ok' as Mode,
  delay: 0,
  scoreCalls: [] as any[],
  finishCalls: [] as any[],
  points: new Map<string, number>(),
  scored: new Set<string>(),
}

type Published = { channel: string; type: string; version: unknown; eventId: unknown; payload: any }
let published: Published[] = []
let channels: (ChannelOptions & { closed: boolean })[] = []
let relayMode: 'ok' | 'hang' = 'ok'

const fakeRelay = (options: ChannelOptions) => {
  const entry = { ...options, closed: false }
  channels.push(entry)
  if (relayMode === 'hang') return new Promise<never>(() => {})
  return Promise.resolve({
    publish: (type: string, message: object) => {
      const { version, eventId, ...payload } = JSON.parse(JSON.stringify(message))
      published.push({ channel: options.channel, type, version, eventId, payload })
    },
    close: () => {
      entry.closed = true
    },
  })
}

const readBody = async (req: IncomingMessage) => {
  let text = ''
  for await (const chunk of req) text += chunk
  return text ? JSON.parse(text) : null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const listen = async (server: Server) => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

const libraryServer = createServer(async (req, res) => {
  library.calls.push(`${req.method} ${req.url} ${req.headers.authorization}`)
  if (library.mode === 'slow') await sleep(TIMEOUT * 3)
  if (library.mode === 'fail') return void res.writeHead(500).end()
  res.writeHead(library.status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ quizId: QUIZ, title: library.title, questions: library.questions }))
})

const scoringServer = createServer(async (req, res) => {
  const body = await readBody(req)
  if (scoring.delay) await sleep(scoring.delay)
  if (scoring.mode === 'slow') await sleep(TIMEOUT * 3)
  if (req.socket.destroyed) return
  if (scoring.mode === 'fail') return void res.writeHead(500).end()
  const board = () =>
    body.participants
      .map((p: any) => ({ playerId: p.playerId, nickname: p.nickname, score: scoring.points.get(p.playerId) ?? 0 }))
      .sort((a: any, b: any) => b.score - a.score)
      .map((p: any, i: number) => ({ ...p, rank: i + 1 }))
  res.writeHead(200, { 'content-type': 'application/json' })
  const score = /\/api\/games\/([^/]+)\/questions\/(\d+)\/score$/.exec(req.url ?? '')
  if (score) {
    scoring.scoreCalls.push({ url: req.url, auth: req.headers.authorization, body })
    if (!scoring.scored.has(req.url!)) {
      scoring.scored.add(req.url!)
      for (const a of body.answers) {
        if (a.optionIndex === body.correctIndex) scoring.points.set(a.playerId, (scoring.points.get(a.playerId) ?? 0) + 1)
      }
    }
    return void res.end(JSON.stringify({ gameId: score[1], questionIndex: Number(score[2]), leaderboard: board() }))
  }
  scoring.finishCalls.push({ url: req.url, body })
  res.end(JSON.stringify({ gameId: 'g', quizTitle: body.quizTitle, finished: true, scoreboard: board() }))
})

let base = ''
let appServer: Server
let deadUrl = ''

before(async () => {
  const libraryUrl = await listen(libraryServer)
  const scoringUrl = await listen(scoringServer)
  const dead = createServer()
  deadUrl = await listen(dead)
  await new Promise((r) => dead.close(r))
  appServer = createApp({ jwtSecret: SECRET, libraryUrl, scoringUrl, timeoutMs: TIMEOUT, openChannel: fakeRelay }).listen(0)
  await new Promise((r) => appServer.once('listening', r))
  base = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`
})

after(() => {
  appServer.close()
  libraryServer.close()
  scoringServer.close()
  appServer.closeAllConnections()
  libraryServer.closeAllConnections()
  scoringServer.closeAllConnections()
})

beforeEach(() => {
  Object.assign(library, { mode: 'ok', status: 200, title: 'Quiz', questions: questions(), calls: [] })
  Object.assign(scoring, { mode: 'ok', delay: 0, scoreCalls: [], finishCalls: [], points: new Map(), scored: new Set() })
  published = []
  channels = []
  relayMode = 'ok'
})

const key = new TextEncoder().encode(SECRET)
const AUDIENCE = ['quizroom-accounts', 'quizroom-library', 'quizroom-scoring', 'quizroom-sessions']
const token = (sub: string, exp: string | number = '1h', secret = key, iss = 'quizroom-accounts', aud: string | string[] = AUDIENCE) =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(secret)

const HOST = randomUUID()
let hostAuth = ''
before(async () => {
  hostAuth = `Bearer ${await token(HOST)}`
})

const call = async (method: string, path: string, body?: unknown, auth?: string, raw?: string) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.json() }
}

const as = (auth: string) => ({
  post: (path: string, body?: unknown) => call('POST', path, body, auth),
})
const hostApi = () => as(hostAuth)

const createRoom = async () => {
  const res = await hostApi().post('/api/rooms', { quizId: QUIZ })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  return res.body as { roomId: string; roomCode: string; channel: string; joinKey: string }
}

const join = async (code: string, nickname: string) => {
  const res = await call('POST', `/api/rooms/${code}/players`, { nickname })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  return res.body as { sessionId: string; participantId: string }
}

const answer = (code: string, sessionId: unknown, optionIndex: unknown) =>
  call('POST', `/api/rooms/${code}/answers`, { sessionId, optionIndex })

const expectProblem = (res: { status: number; type: string; body: any }, status: number, code: string) => {
  assert.equal(res.status, status, JSON.stringify(res.body))
  assert.match(res.type, /application\/problem\+json/)
  assert.equal(res.body.code, code)
  assert.equal(res.body.type, 'about:blank')
  assert.equal(res.body.status, status)
  assert.equal(typeof res.body.title, 'string')
  assert.equal(typeof res.body.detail, 'string')
}

const events = (type: string) => published.filter((e) => e.type === type).map((e) => e.payload)

describe('authentication and ownership', () => {
  test('missing, invalid and expired tokens get 401', async () => {
    expectProblem(await call('POST', '/api/rooms', { quizId: QUIZ }), 401, 'UNAUTHORIZED')
    expectProblem(await as('Bearer nonsense').post('/api/rooms', { quizId: QUIZ }), 401, 'UNAUTHORIZED')
    const wrongKey = await token(HOST, '1h', new TextEncoder().encode('another-secret-another-secret-12345'))
    expectProblem(await as(`Bearer ${wrongKey}`).post('/api/rooms', { quizId: QUIZ }), 401, 'UNAUTHORIZED')
    const expired = await token(HOST, Math.floor(Date.now() / 1000) - 60)
    expectProblem(await as(`Bearer ${expired}`).post('/api/rooms/ABCDEF/start'), 401, 'UNAUTHORIZED')
    const wrongAudience = await token(HOST, '1h', key, 'quizroom-accounts', ['quizroom-library', 'quizroom-scoring'])
    expectProblem(await as(`Bearer ${wrongAudience}`).post('/api/rooms', { quizId: QUIZ }), 401, 'UNAUTHORIZED')
    const wrongIssuer = await token(HOST, '1h', key, 'someone-else')
    expectProblem(await as(`Bearer ${wrongIssuer}`).post('/api/rooms', { quizId: QUIZ }), 401, 'UNAUTHORIZED')
    const noClaims = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(HOST).setExpirationTime('1h').sign(key)
    expectProblem(await as(`Bearer ${noClaims}`).post('/api/rooms', { quizId: QUIZ }), 401, 'UNAUTHORIZED')
    assert.equal(library.calls.length, 0)
  })

  test('another host gets 404 for every control endpoint', async () => {
    const room = await createRoom()
    const other = as(`Bearer ${await token(randomUUID())}`)
    for (const action of ['start', 'open-question', 'close-question', 'end']) {
      expectProblem(await other.post(`/api/rooms/${room.roomCode}/${action}`), 404, 'ROOM_NOT_FOUND')
    }
    assert.equal((await call('GET', `/api/rooms/${room.roomCode}`)).body.status, 'LOBBY')
  })
})

describe('creating a room', () => {
  test('takes a snapshot with the host token and opens a relay channel', async () => {
    const room = await createRoom()
    assert.match(room.roomCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
    assert.equal(room.channel, `quizroom-${room.roomId}`)
    assert.deepEqual(Object.keys(room).sort(), ['channel', 'joinKey', 'roomCode', 'roomId'])
    assert.deepEqual(library.calls, [`GET /api/quizzes/${QUIZ}/snapshot ${hostAuth}`])
    const [channel] = channels
    assert.equal(channel.channel, room.channel)
    assert.equal(channel.joinKey, room.joinKey)
    assert.ok(channel.sendKey.length >= 32)
    assert.notEqual(channel.sendKey, channel.joinKey)
    const status = await call('GET', `/api/rooms/${room.roomCode.toLowerCase()}`)
    assert.deepEqual(status.body, { status: 'LOBBY' })
  })

  test('maps library answers to defined errors', async () => {
    expectProblem(await hostApi().post('/api/rooms', { quizId: 'not-a-uuid' }), 400, 'INVALID_REQUEST')
    expectProblem(await hostApi().post('/api/rooms', {}), 400, 'INVALID_REQUEST')
    library.status = 404
    expectProblem(await hostApi().post('/api/rooms', { quizId: QUIZ }), 404, 'QUIZ_NOT_FOUND')
    library.status = 409
    expectProblem(await hostApi().post('/api/rooms', { quizId: QUIZ }), 409, 'QUIZ_NOT_READY')
    library.status = 400
    expectProblem(await hostApi().post('/api/rooms', { quizId: QUIZ }), 400, 'INVALID_REQUEST')
    library.status = 200
    library.mode = 'fail'
    expectProblem(await hostApi().post('/api/rooms', { quizId: QUIZ }), 503, 'LIBRARY_UNAVAILABLE')
    assert.equal(channels.length, 0)
  })

  test('slow library gives 503 within the timeout', async () => {
    library.mode = 'slow'
    const started = Date.now()
    expectProblem(await hostApi().post('/api/rooms', { quizId: QUIZ }), 503, 'LIBRARY_UNAVAILABLE')
    assert.ok(Date.now() - started < TIMEOUT * 2, `took ${Date.now() - started} ms`)
  })

  test('unreachable library gives 503', async () => {
    const app = createApp({
      jwtSecret: SECRET,
      libraryUrl: deadUrl,
      scoringUrl: deadUrl,
      timeoutMs: TIMEOUT,
      openChannel: fakeRelay,
    }).listen(0)
    await new Promise((r) => app.once('listening', r))
    const res = await fetch(`http://127.0.0.1:${(app.address() as AddressInfo).port}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: hostAuth },
      body: JSON.stringify({ quizId: QUIZ }),
    })
    assert.equal(res.status, 503)
    assert.equal((await res.json()).code, 'LIBRARY_UNAVAILABLE')
    app.close()
  })

  test('relay that never connects gives 503 RELAY_UNAVAILABLE', async () => {
    relayMode = 'hang'
    expectProblem(await hostApi().post('/api/rooms', { quizId: QUIZ }), 503, 'RELAY_UNAVAILABLE')
  })

  test('the snapshot is fixed when the library changes afterwards', async () => {
    const room = await createRoom()
    library.questions = [{ text: 'Changed?', options: ['1', '2', '3', '4'], correctIndex: 0, explanation: 'x' }]
    await hostApi().post(`/api/rooms/${room.roomCode}/start`)
    await hostApi().post(`/api/rooms/${room.roomCode}/open-question`)
    assert.equal(events('question:opened')[0].text, 'Q1?')
    assert.deepEqual(events('game:started'), [{ questionCount: 2 }])
  })
})

describe('game state transitions', () => {
  test('invalid transitions are rejected with 409', async () => {
    const room = await createRoom()
    const host = hostApi()
    const path = (action: string) => `/api/rooms/${room.roomCode}/${action}`
    const p = await join(room.roomCode, 'Ann')
    expectProblem(await host.post(path('open-question')), 409, 'INVALID_STATE')
    expectProblem(await host.post(path('close-question')), 409, 'INVALID_STATE')
    expectProblem(await answer(room.roomCode, p.sessionId, 0), 409, 'QUESTION_CLOSED')
    assert.equal((await host.post(path('start'))).status, 200)
    expectProblem(await host.post(path('start')), 409, 'INVALID_STATE')
    expectProblem(await call('POST', `/api/rooms/${room.roomCode}/players`, { nickname: 'Late' }), 409, 'ROOM_NOT_JOINABLE')
    expectProblem(await host.post(path('close-question')), 409, 'INVALID_STATE')
    assert.deepEqual((await host.post(path('open-question'))).body, { index: 0 })
    expectProblem(await host.post(path('open-question')), 409, 'INVALID_STATE')
    expectProblem(await host.post(path('end')), 409, 'INVALID_STATE')
    assert.equal((await host.post(path('close-question'))).status, 200)
    expectProblem(await answer(room.roomCode, p.sessionId, 0), 409, 'QUESTION_CLOSED')
    expectProblem(await host.post(path('close-question')), 409, 'INVALID_STATE')
    await host.post(path('open-question'))
    await host.post(path('close-question'))
    expectProblem(await host.post(path('open-question')), 409, 'INVALID_STATE')
    const end = await host.post(path('end'))
    assert.equal(end.status, 200)
    assert.equal(end.body.finished, true)
    assert.deepEqual((await call('GET', path('').slice(0, -1))).body, { status: 'FINISHED' })
    expectProblem(await host.post(path('start')), 409, 'INVALID_STATE')
    expectProblem(await host.post(path('open-question')), 409, 'INVALID_STATE')
    assert.deepEqual((await host.post(path('end'))).body, end.body)
    assert.equal(scoring.finishCalls.length, 1)
    assert.equal(events('game:ended').length, 1)
    assert.ok(channels[0].closed)
  })

  test('end from the lobby finishes the game; scoring failure leaves the room unchanged', async () => {
    const room = await createRoom()
    await join(room.roomCode, 'Ann')
    scoring.mode = 'fail'
    expectProblem(await hostApi().post(`/api/rooms/${room.roomCode}/end`), 503, 'SCORING_UNAVAILABLE')
    assert.deepEqual((await call('GET', `/api/rooms/${room.roomCode}`)).body, { status: 'LOBBY' })
    assert.equal(events('game:ended').length, 0)
    expectProblem(await call('POST', `/api/rooms/${room.roomCode}/players`, { nickname: 'Bob' }), 409, 'ROOM_NOT_JOINABLE')
    expectProblem(await hostApi().post(`/api/rooms/${room.roomCode}/start`), 409, 'INVALID_STATE')
    scoring.mode = 'ok'
    const end = await hostApi().post(`/api/rooms/${room.roomCode}/end`)
    assert.equal(end.status, 200)
    assert.equal(end.body.scoreboard[0].nickname, 'Ann')
    assert.equal(scoring.finishCalls[0].body.quizTitle, 'Quiz')
  })

  test('an end that timed out blocks further play until end is retried', async () => {
    const room = await createRoom()
    const host = hostApi()
    const path = (action: string) => `/api/rooms/${room.roomCode}/${action}`
    await join(room.roomCode, 'Ann')
    await host.post(path('start'))
    await host.post(path('open-question'))
    assert.equal((await host.post(path('close-question'))).status, 200)
    scoring.delay = TIMEOUT * 2
    expectProblem(await host.post(path('end')), 503, 'SCORING_UNAVAILABLE')
    scoring.delay = 0
    expectProblem(await host.post(path('open-question')), 409, 'INVALID_STATE')
    assert.deepEqual((await call('GET', path('').slice(0, -1))).body, { status: 'IN_PROGRESS' })
    const end = await host.post(path('end'))
    assert.equal(end.status, 200)
    assert.equal(end.body.finished, true)
    assert.equal(events('question:opened').length, 1)
  })

  test('idle rooms expire and their channel is closed', async () => {
    const app = createApp({
      jwtSecret: SECRET,
      libraryUrl: `http://127.0.0.1:${(libraryServer.address() as AddressInfo).port}`,
      scoringUrl: deadUrl,
      timeoutMs: TIMEOUT,
      openChannel: fakeRelay,
      roomTtlMs: 100,
    }).listen(0)
    await new Promise((r) => app.once('listening', r))
    const url = `http://127.0.0.1:${(app.address() as AddressInfo).port}/api/rooms`
    const create = () =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: hostAuth },
        body: JSON.stringify({ quizId: QUIZ }),
      }).then((r) => r.json())
    const first = await create()
    await sleep(150)
    await create()
    assert.equal((await fetch(`${url}/${first.roomCode}`)).status, 404)
    assert.deepEqual(
      channels.map((c) => c.closed),
      [true, false],
    )
    app.close()
  })
})

describe('players and answers', () => {
  test('join validation', async () => {
    const room = await createRoom()
    expectProblem(await call('POST', '/api/rooms/ZZZZZZ/players', { nickname: 'Ann' }), 404, 'ROOM_NOT_FOUND')
    expectProblem(await call('GET', '/api/rooms/ZZZZZZ'), 404, 'ROOM_NOT_FOUND')
    for (const nickname of ['', '   ', 'x'.repeat(21), 42, null]) {
      expectProblem(await call('POST', `/api/rooms/${room.roomCode}/players`, { nickname }), 400, 'INVALID_REQUEST')
    }
    await join(room.roomCode, '  Ann  ')
    expectProblem(await call('POST', `/api/rooms/${room.roomCode}/players`, { nickname: 'aNN' }), 409, 'NICKNAME_TAKEN')
    assert.deepEqual(
      events('participants:update').at(-1)!.participants.map((p: any) => [p.nickname, p.connected]),
      [['Ann', false]],
    )
  })

  test('rooms are capped at 100 players', async () => {
    const room = await createRoom()
    await Promise.all(Array.from({ length: 100 }, (_, i) => join(room.roomCode, `P${i}`)))
    expectProblem(await call('POST', `/api/rooms/${room.roomCode}/players`, { nickname: 'Extra' }), 409, 'ROOM_FULL')
  })

  test('duplicate answers keep the first one; unknown sessions and bad options are rejected', async () => {
    const room = await createRoom()
    const ann = await join(room.roomCode, 'Ann')
    const bob = await join(room.roomCode, 'Bob')
    await hostApi().post(`/api/rooms/${room.roomCode}/start`)
    await hostApi().post(`/api/rooms/${room.roomCode}/open-question`)
    for (const bad of [4, -1, 1.5, '1', null, undefined]) {
      expectProblem(await answer(room.roomCode, ann.sessionId, bad), 400, 'INVALID_REQUEST')
    }
    expectProblem(await answer(room.roomCode, undefined, 1), 400, 'INVALID_REQUEST')
    expectProblem(await answer(room.roomCode, 'not-a-session', 1), 403, 'NOT_IN_ROOM')
    expectProblem(await answer(room.roomCode, ann.participantId, 1), 403, 'NOT_IN_ROOM')
    assert.deepEqual((await answer(room.roomCode, ann.sessionId, 1)).body, { accepted: true, index: 0 })
    expectProblem(await answer(room.roomCode, ann.sessionId, 2), 409, 'ALREADY_ANSWERED')
    await hostApi().post(`/api/rooms/${room.roomCode}/close-question`)
    assert.deepEqual(scoring.scoreCalls[0].body.answers, [{ playerId: ann.participantId, optionIndex: 1 }])
    assert.deepEqual(
      scoring.scoreCalls[0].body.participants.map((p: any) => p.playerId),
      [ann.participantId, bob.participantId],
    )
    assert.deepEqual(events('answers:count'), [{ index: 0, submitted: 1, total: 2 }])
  })

  test('presence follows relay join and leave events for participants only', async () => {
    const room = await createRoom()
    const ann = await join(room.roomCode, 'Ann')
    published = []
    channels[0].onJoin('someone-else')
    assert.equal(published.length, 0)
    channels[0].onJoin(ann.participantId)
    assert.deepEqual(events('participants:update').at(-1), {
      participants: [{ participantId: ann.participantId, nickname: 'Ann', connected: true }],
    })
    channels[0].onLeave(ann.participantId)
    assert.equal(events('participants:update').at(-1).participants[0].connected, false)
  })
})

describe('reveal and scoring', () => {
  test('question:opened never carries the answer; no event carries a sessionId', async () => {
    const room = await createRoom()
    const players = [await join(room.roomCode, 'Ann'), await join(room.roomCode, 'Bob')]
    channels[0].onJoin(players[0].participantId)
    const host = hostApi()
    await host.post(`/api/rooms/${room.roomCode}/start`)
    for (let i = 0; i < 2; i++) {
      await host.post(`/api/rooms/${room.roomCode}/open-question`)
      await answer(room.roomCode, players[0].sessionId, 1)
      await answer(room.roomCode, players[1].sessionId, 2)
      const closed = await host.post(`/api/rooms/${room.roomCode}/close-question`)
      assert.equal(closed.body.index, i)
    }
    await host.post(`/api/rooms/${room.roomCode}/end`)
    for (const opened of events('question:opened')) assert.deepEqual(Object.keys(opened).sort(), ['index', 'options', 'text'])
    assert.deepEqual(events('question:closed'), [
      { index: 0, correctIndex: 1, explanation: 'because b' },
      { index: 1, correctIndex: 2, explanation: null },
    ])
    const all = JSON.stringify(published)
    assert.ok(!all.includes(channels[0].sendKey))
    for (const p of players) assert.ok(!all.includes(p.sessionId))
    for (const call of scoring.scoreCalls) {
      assert.equal(call.auth, hostAuth)
      assert.ok(!JSON.stringify(call.body).includes(players[0].sessionId))
    }
    assert.deepEqual(
      published.map((e) => e.type).filter((t) => t !== 'answers:count' && t !== 'participants:update'),
      [
        'game:started',
        'question:opened',
        'question:closed',
        'leaderboard:update',
        'question:opened',
        'question:closed',
        'leaderboard:update',
        'game:ended',
      ],
    )
  })

  test('scoring unavailable on close: 503, nothing revealed, retry scores once', async () => {
    const room = await createRoom()
    const ann = await join(room.roomCode, 'Ann')
    const host = hostApi()
    await host.post(`/api/rooms/${room.roomCode}/start`)
    await host.post(`/api/rooms/${room.roomCode}/open-question`)
    await answer(room.roomCode, ann.sessionId, 1)
    scoring.mode = 'slow'
    const started = Date.now()
    expectProblem(await host.post(`/api/rooms/${room.roomCode}/close-question`), 503, 'SCORING_UNAVAILABLE')
    assert.ok(Date.now() - started < TIMEOUT * 2)
    scoring.mode = 'fail'
    expectProblem(await host.post(`/api/rooms/${room.roomCode}/close-question`), 503, 'SCORING_UNAVAILABLE')
    expectProblem(await answer(room.roomCode, ann.sessionId, 2), 409, 'QUESTION_CLOSED')
    expectProblem(await host.post(`/api/rooms/${room.roomCode}/open-question`), 409, 'INVALID_STATE')
    expectProblem(await host.post(`/api/rooms/${room.roomCode}/end`), 409, 'INVALID_STATE')
    assert.equal(events('question:closed').length, 0)
    assert.equal(events('leaderboard:update').length, 0)
    scoring.mode = 'ok'
    const retry = await host.post(`/api/rooms/${room.roomCode}/close-question`)
    assert.equal(retry.status, 200)
    assert.deepEqual(retry.body.leaderboard, [{ playerId: ann.participantId, nickname: 'Ann', score: 1, rank: 1 }])
    expectProblem(await host.post(`/api/rooms/${room.roomCode}/close-question`), 409, 'INVALID_STATE')
    assert.equal(events('question:closed').length, 1)
    assert.equal(events('leaderboard:update').length, 1)
    assert.equal(scoring.points.get(ann.participantId), 1)
  })

  test('concurrent close calls score and publish once', async () => {
    const room = await createRoom()
    await join(room.roomCode, 'Ann')
    const host = hostApi()
    await host.post(`/api/rooms/${room.roomCode}/start`)
    await host.post(`/api/rooms/${room.roomCode}/open-question`)
    scoring.delay = 50
    const results = await Promise.all([1, 2, 3].map(() => host.post(`/api/rooms/${room.roomCode}/close-question`)))
    for (const r of results) assert.ok(r.status === 200 || r.status === 409, JSON.stringify(r.body))
    assert.ok(results.some((r) => r.status === 200))
    assert.equal(scoring.scoreCalls.length, 1)
    assert.equal(events('question:closed').length, 1)
    assert.equal(events('leaderboard:update').length, 1)
  })

  test('one host and ten players join and answer concurrently', async () => {
    const room = await createRoom()
    const names = Array.from({ length: 10 }, (_, i) => `Player${i}`)
    const players = await Promise.all(names.map((n) => join(room.roomCode, n)))
    const host = hostApi()
    await host.post(`/api/rooms/${room.roomCode}/start`)
    await host.post(`/api/rooms/${room.roomCode}/open-question`)
    const answers = await Promise.all(
      players.flatMap((p, i) => [answer(room.roomCode, p.sessionId, i % 4), answer(room.roomCode, p.sessionId, 3)]),
    )
    assert.equal(answers.filter((a) => a.status === 200).length, 10)
    assert.equal(answers.filter((a) => a.body.code === 'ALREADY_ANSWERED').length, 10)
    const counts = events('answers:count')
    assert.deepEqual(
      counts.map((c) => c.submitted),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    )
    assert.ok(counts.every((c) => c.total === 10 && c.index === 0))
    const closed = await host.post(`/api/rooms/${room.roomCode}/close-question`)
    assert.equal(closed.body.leaderboard.length, 10)
    assert.equal(scoring.scoreCalls[0].body.answers.length, 10)
    assert.equal(scoring.scoreCalls[0].body.participants.length, 10)
  })
})

describe('relay envelope', () => {
  test('every event has version 1 and a per-room eventId counting up from 1', async () => {
    const first = await createRoom()
    await join(first.roomCode, 'Ann')
    await hostApi().post(`/api/rooms/${first.roomCode}/start`)
    const second = await createRoom()
    await join(second.roomCode, 'Bob')
    await hostApi().post(`/api/rooms/${first.roomCode}/open-question`)
    for (const room of [first, second]) {
      const mine = published.filter((e) => e.channel === room.channel)
      assert.ok(mine.length > 0)
      assert.ok(mine.every((e) => e.version === 1))
      assert.deepEqual(
        mine.map((e) => e.eventId),
        mine.map((_, i) => i + 1),
      )
    }
  })
})

describe('room snapshot', () => {
  const get = async (code: string, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}/api/rooms/${code}`, { headers })
    return { status: res.status, body: await res.json() }
  }
  const asPlayer = (code: string, sessionId: string) => get(code, { 'x-session-id': sessionId })
  const asHost = (code: string) => get(code, { authorization: hostAuth })

  test('without valid credentials only the status is returned', async () => {
    const room = await createRoom()
    const ann = await join(room.roomCode, 'Ann')
    const other = `Bearer ${await token(randomUUID())}`
    const wrongAudience = `Bearer ${await token(HOST, '1h', key, 'quizroom-accounts', 'quizroom-library')}`
    for (const headers of [
      {},
      { authorization: other },
      { authorization: wrongAudience },
      { authorization: 'Bearer nonsense' },
      { 'x-session-id': 'not-a-session' },
      { 'x-session-id': ann.participantId },
    ] as Record<string, string>[]) {
      assert.deepEqual(await get(room.roomCode, headers), { status: 200, body: { status: 'LOBBY' } })
    }
    const elsewhere = await createRoom()
    assert.deepEqual((await asPlayer(elsewhere.roomCode, ann.sessionId)).body, { status: 'LOBBY' })
    assert.equal((await get('ZZZZZZ', { authorization: hostAuth })).status, 404)
  })

  test('player and host get the full snapshot; the answer appears only after scoring', async () => {
    const room = await createRoom()
    const ann = await join(room.roomCode, 'Ann')
    const lobby = (await asPlayer(room.roomCode, ann.sessionId)).body
    const { myAnswer, ...hostView } = lobby
    assert.equal(myAnswer, null)
    assert.deepEqual(hostView, {
      status: 'LOBBY',
      eventId: 1,
      questionCount: 2,
      participants: [{ participantId: ann.participantId, nickname: 'Ann', connected: false }],
      question: null,
      open: false,
      answers: null,
      reveal: null,
      leaderboard: [],
      scoreboard: null,
    })
    assert.deepEqual((await asHost(room.roomCode)).body, hostView)

    const host = hostApi()
    await host.post(`/api/rooms/${room.roomCode}/start`)
    await host.post(`/api/rooms/${room.roomCode}/open-question`)
    assert.equal((await asPlayer(room.roomCode, ann.sessionId)).body.myAnswer, null)
    await answer(room.roomCode, ann.sessionId, 1)
    assert.equal((await asPlayer(room.roomCode, ann.sessionId)).body.myAnswer, 1)
    assert.ok(!('myAnswer' in (await asHost(room.roomCode)).body))
    const open = (await asHost(room.roomCode)).body
    assert.equal(open.status, 'IN_PROGRESS')
    assert.equal(open.eventId, published.at(-1)!.eventId)
    assert.deepEqual(open.question, { index: 0, text: 'Q1?', options: ['a', 'b', 'c', 'd'] })
    assert.equal(open.open, true)
    assert.deepEqual(open.answers, { index: 0, submitted: 1, total: 1 })
    assert.equal(open.reveal, null)
    assert.ok(!JSON.stringify(open).includes('correctIndex'))
    assert.ok(!JSON.stringify(await asPlayer(room.roomCode, ann.sessionId)).includes('correctIndex'))

    scoring.mode = 'fail'
    expectProblem(await host.post(`/api/rooms/${room.roomCode}/close-question`), 503, 'SCORING_UNAVAILABLE')
    for (const view of [await asHost(room.roomCode), await asPlayer(room.roomCode, ann.sessionId)]) {
      assert.equal(view.body.open, false)
      assert.equal(view.body.reveal, null)
      assert.deepEqual(view.body.leaderboard, [])
      assert.ok(!JSON.stringify(view.body).includes('correctIndex'))
      assert.ok(!JSON.stringify(view.body).includes('because b'))
    }

    scoring.mode = 'ok'
    await host.post(`/api/rooms/${room.roomCode}/close-question`)
    const scored = (await asPlayer(room.roomCode, ann.sessionId)).body
    assert.deepEqual(scored.question, { index: 0, text: 'Q1?', options: ['a', 'b', 'c', 'd'] })
    assert.deepEqual(scored.reveal, { index: 0, correctIndex: 1, explanation: 'because b' })
    assert.deepEqual(scored.leaderboard, [{ playerId: ann.participantId, nickname: 'Ann', score: 1, rank: 1 }])
    assert.equal(scored.eventId, published.at(-1)!.eventId)

    await host.post(`/api/rooms/${room.roomCode}/open-question`)
    const next = (await asHost(room.roomCode)).body
    assert.equal(next.reveal, null)
    assert.deepEqual(next.answers, { index: 1, submitted: 0, total: 1 })
    assert.deepEqual(next.leaderboard, scored.leaderboard)
    await host.post(`/api/rooms/${room.roomCode}/close-question`)
    const end = await host.post(`/api/rooms/${room.roomCode}/end`)
    const finished = (await asHost(room.roomCode)).body
    assert.equal(finished.status, 'FINISHED')
    assert.deepEqual(finished.scoreboard, end.body.scoreboard)
    assert.equal(finished.eventId, published.at(-1)!.eventId)
    assert.deepEqual(await get(room.roomCode), { status: 200, body: { status: 'FINISHED' } })
  })
})

describe('error handling', () => {
  test('malformed JSON, wrong body types and unknown routes', async () => {
    expectProblem(await call('POST', '/api/rooms', undefined, hostAuth, '{"quizId":'), 400, 'INVALID_REQUEST')
    expectProblem(await call('POST', '/api/rooms', undefined, hostAuth, '[1,2]'), 400, 'INVALID_REQUEST')
    const room = await createRoom()
    expectProblem(await call('POST', `/api/rooms/${room.roomCode}/players`, undefined, undefined, '{bad'), 400, 'INVALID_REQUEST')
    expectProblem(await call('GET', '/nope'), 404, 'NOT_FOUND')
    expectProblem(await call('DELETE', `/api/rooms/${room.roomCode}`), 404, 'NOT_FOUND')
  })
})

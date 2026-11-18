import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { connect, type IttySocketOptions } from 'itty-sockets'

const env = process.env
const ACCOUNTS = env.E2E_ACCOUNTS_URL ?? 'http://localhost:18081'
const LIBRARY = env.E2E_LIBRARY_URL ?? 'http://localhost:18082'
const SCORING = env.E2E_SCORING_URL ?? 'http://localhost:18083'
const LGS = env.E2E_LGS_URL ?? 'http://localhost:13000'
const STOP_SCORING = env.E2E_STOP_SCORING
const START_SCORING = env.E2E_START_SCORING
const WAIT_MS = 15000

type Reply = { status: number; body: any }
type Client = { name: string; events: any[]; socket: ReturnType<typeof connect> }

const run = Date.now().toString(36)
const clients: Client[] = []
const retired: Client[] = []
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function call(method: string, url: string, token?: string, body?: unknown): Promise<Reply> {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(WAIT_MS),
  })
  const text = await res.text()
  let parsed: any = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {}
  return { status: res.status, body: parsed }
}

function expect(reply: Reply, status: number, code?: string) {
  assert.equal(reply.status, status, `expected ${status}${code ? ' ' + code : ''}, got ${reply.status} ${JSON.stringify(reply.body)}`)
  if (code) assert.equal(reply.body?.code, code, `expected code ${code}, got ${JSON.stringify(reply.body)}`)
  return reply.body
}

async function step(name: string, fn: () => Promise<unknown>) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: any) {
    console.log(`FAIL ${name}: ${error?.message ?? error}`)
    await finish(1)
  }
}

async function finish(code: number): Promise<never> {
  for (const client of clients) client.socket.close()
  await sleep(200)
  process.exit(code)
}

function listen(name: string, channel: string, options: object): Promise<Client> {
  const client: Client = { name, events: [], socket: connect(channel, options as IttySocketOptions) }
  clients.push(client)
  return new Promise((resolve, reject) => {
    let opened = false
    const timer = setTimeout(() => reject(new Error(`${name} could not connect to the relay`)), WAIT_MS)
    client.socket
      .on('*', (event: any) => void client.events.push(event))
      .on('open', () => {
        opened = true
        clearTimeout(timer)
        resolve(client)
      })
      .on('close', () => opened || reject(new Error(`${name} was rejected by the relay`)))
  })
}

async function waitFor(client: Client, label: string, match: (event: any) => boolean, since = 0) {
  const until = Date.now() + WAIT_MS
  for (;;) {
    const found = client.events.slice(since).find(match)
    if (found) return found
    if (Date.now() > until) throw new Error(`${client.name} did not receive ${label}`)
    await sleep(25)
  }
}

const everyone = (label: string, match: (event: any) => boolean) =>
  Promise.all(clients.map((client) => waitFor(client, label, match)))

const QUESTIONS = [
  { text: 'What does HTTP 404 mean?', options: ['OK', 'Not Found', 'Forbidden', 'Server Error'], correctIndex: 1, explanation: '404 means the resource was not found.' },
  { text: 'Which port is HTTPS by default?', options: ['21', '80', '8080', '443'], correctIndex: 3, explanation: 'HTTPS uses port 443.' },
  { text: 'What does JSON stand for?', options: ['JavaScript Object Notation', 'Java Serialized Object Network', 'Joined Simple Object Names', 'None'], correctIndex: 0, explanation: null },
]
const CORRECT_BELOW = [7, 4, 9]
const PLAYERS = 10
const OUTAGE_QUESTION = 1

const choice = (player: number, q: number) =>
  player < CORRECT_BELOW[q] ? QUESTIONS[q].correctIndex : (QUESTIONS[q].correctIndex + 1) % 4

const scoreAfter = (player: number, q: number) => {
  let score = 0
  for (let i = 0; i <= q; i++) if (choice(player, i) === QUESTIONS[i].correctIndex) score++
  return score
}

const state = {
  host: '',
  other: '',
  quizId: '',
  questionIds: [] as string[],
  roomId: '',
  code: '',
  channel: '',
  joinKey: '',
  players: [] as { nickname: string; sessionId: string; participantId: string; index: number }[],
  hostClient: null as Client | null,
  results: null as any,
}

function checkStandings(rows: any, q: number) {
  assert.ok(Array.isArray(rows), `standings missing: ${JSON.stringify(rows)}`)
  assert.equal(new Set(rows.map((r: any) => r.playerId)).size, PLAYERS, 'standings must list every player once')
  assert.ok(rows.every((r: any, i: number) => i === 0 || rows[i - 1].score >= r.score), 'standings must be sorted by score')
  const expected = new Map(state.players.map((p) => [p.participantId, { nickname: p.nickname, score: scoreAfter(p.index, q) }]))
  for (const row of rows) {
    const want = expected.get(row.playerId)
    assert.ok(want, `unknown playerId ${row.playerId}`)
    assert.equal(row.nickname, want.nickname)
    assert.equal(row.score, want.score, `${row.nickname} should have ${want.score} after question ${q}, got ${row.score}`)
    const rank = 1 + [...expected.values()].filter((e) => e.score > want.score).length
    assert.equal(row.rank, rank, `${row.nickname} should be rank ${rank}, got ${row.rank}`)
  }
}

const standingsMatch = (rows: any, q: number) => {
  try {
    checkStandings(rows, q)
    return true
  } catch {
    return false
  }
}

const room = (path = '') => `${LGS}/api/rooms/${state.code}${path}`
const score = (q: number) => `${SCORING}/api/games/${state.roomId}/questions/${q}/score`

async function waitForScoring() {
  const until = Date.now() + 120000
  for (;;) {
    try {
      if ((await call('GET', `${SCORING}/api/games`, state.host)).status === 200) return
    } catch {}
    if (Date.now() > until) throw new Error('Scoring did not come back within 120 s')
    await sleep(500)
  }
}

async function playQuestion(q: number) {
  const question = QUESTIONS[q]
  await step(`Q${q}: host opens question ${q}`, async () => {
    assert.deepEqual(expect(await call('POST', room('/open-question'), state.host), 200), { index: q })
  })
  await step(`Q${q}: open while open -> 409 INVALID_STATE`, async () => {
    expect(await call('POST', room('/open-question'), state.host), 409, 'INVALID_STATE')
  })
  await step(`Q${q}: host + ${PLAYERS} players receive question:opened without correctIndex/explanation`, async () => {
    const events = await everyone(`question:opened ${q}`, (e) => e.type === 'question:opened' && e.index === q)
    for (const event of events) {
      assert.deepEqual(Object.keys(event.message).sort(), ['eventId', 'index', 'options', 'text', 'type', 'version'])
      assert.equal(event.text, question.text, 'question text must come from the room snapshot')
      assert.deepEqual(event.options, question.options)
      const raw = JSON.stringify(event)
      assert.ok(!raw.includes('correctIndex') && !raw.includes('explanation'), `answer leaked: ${raw}`)
    }
  })
  await step(`Q${q}: ${PLAYERS} players answer concurrently, all accepted`, async () => {
    const replies = await Promise.all(
      state.players.map((p) => call('POST', room('/answers'), undefined, { sessionId: p.sessionId, optionIndex: choice(p.index, q) })),
    )
    for (const reply of replies) assert.deepEqual(expect(reply, 200), { accepted: true, index: q })
  })
  await step(`Q${q}: duplicate answer -> 409 ALREADY_ANSWERED`, async () => {
    const first = state.players[0]
    const other = (choice(first.index, q) + 2) % 4
    expect(await call('POST', room('/answers'), undefined, { sessionId: first.sessionId, optionIndex: other }), 409, 'ALREADY_ANSWERED')
  })
  await step(`Q${q}: unknown session -> 403 NOT_IN_ROOM`, async () => {
    expect(await call('POST', room('/answers'), undefined, { sessionId: 'not-a-real-session', optionIndex: 0 }), 403, 'NOT_IN_ROOM')
  })
  await step(`Q${q}: host sees answers:count reach ${PLAYERS}/${PLAYERS}`, async () => {
    await waitFor(state.hostClient!, 'answers:count 10', (e) => e.type === 'answers:count' && e.index === q && e.submitted === PLAYERS && e.total === PLAYERS)
    const counts = state.hostClient!.events.filter((e) => e.type === 'answers:count' && e.index === q)
    assert.ok(counts.every((e) => e.submitted <= PLAYERS), 'answers:count went past the player count')
  })
  if (q === 0) {
    await step('Q0: end while a question is open -> 409 INVALID_STATE', async () => {
      expect(await call('POST', room('/end'), state.host), 409, 'INVALID_STATE')
    })
    await step('Q0: second host closing the room -> 404 ROOM_NOT_FOUND', async () => {
      expect(await call('POST', room('/close-question'), state.other), 404, 'ROOM_NOT_FOUND')
    })
  }
  if (q === OUTAGE_QUESTION) await outage(q)
  let leaderboard: any
  await step(`Q${q}: host closes question ${q} -> 200 leaderboard`, async () => {
    const body = expect(await call('POST', room('/close-question'), state.host), 200)
    assert.equal(body.index, q)
    checkStandings(body.leaderboard, q)
    leaderboard = body.leaderboard
  })
  await step(`Q${q}: everyone receives question:closed and leaderboard:update with expected totals`, async () => {
    const closed = await everyone(`question:closed ${q}`, (e) => e.type === 'question:closed' && e.index === q)
    for (const event of closed) {
      assert.equal(event.correctIndex, question.correctIndex)
      assert.equal(event.explanation, question.explanation)
    }
    await everyone(`leaderboard:update after ${q}`, (e) => e.type === 'leaderboard:update' && standingsMatch(e.leaderboard, q))
    for (const client of clients) {
      const boards = client.events.filter((e) => e.type === 'leaderboard:update')
      assert.equal(boards.length, q + 1, `${client.name} should have ${q + 1} leaderboard:update events, got ${boards.length}`)
      checkStandings(boards[q].leaderboard, q)
    }
    for (const client of clients) {
      const n = client.events.filter((e) => e.type === 'question:closed' && e.index === q).length
      assert.equal(n, 1, `${client.name} got question:closed ${q} ${n} times`)
    }
  })
  if (q === 0) await repeatedScoring(leaderboard)
}

async function repeatedScoring(leaderboard: any) {
  const q = 0
  const body = {
    quizTitle: `E2E Quiz ${run}`,
    correctIndex: QUESTIONS[q].correctIndex,
    participants: state.players.map((p) => ({ playerId: p.participantId, nickname: p.nickname })),
    answers: state.players.map((p) => ({ playerId: p.participantId, optionIndex: choice(p.index, q) })),
  }
  await step('Repeated scoring: same score request for question 0 straight to Scoring -> 200, totals unchanged', async () => {
    const reply = expect(await call('POST', score(q), state.host, body), 200)
    checkStandings(reply.leaderboard, q)
    assert.deepEqual(reply.leaderboard, leaderboard)
  })
  await step('Repeated scoring: everyone-correct request for question 0 still changes nothing', async () => {
    const allRight = { ...body, answers: body.answers.map((a) => ({ ...a, optionIndex: QUESTIONS[q].correctIndex })) }
    checkStandings(expect(await call('POST', score(q), state.host, allRight), 200).leaderboard, q)
    const results = expect(await call('GET', `${SCORING}/api/games/${state.roomId}/results`, state.host), 200)
    assert.equal(results.questionsScored, 1)
    assert.equal(results.finished, false)
    checkStandings(results.scoreboard, q)
  })
  await step('Repeated scoring: second host sending the score request -> 404', async () => {
    expect(await call('POST', score(q), state.other, body), 404)
  })
}

async function outage(q: number) {
  if (!STOP_SCORING || !START_SCORING) {
    console.log('SKIP scoring outage: set E2E_STOP_SCORING and E2E_START_SCORING to shell commands that stop/start Scoring')
    return
  }
  await step('Outage: stop the Scoring process', async () => {
    execSync(STOP_SCORING, { stdio: 'ignore' })
    const until = Date.now() + 30000
    for (;;) {
      const up = await call('GET', `${SCORING}/api/games`, state.host).then(() => true, () => false)
      if (!up) return
      if (Date.now() > until) throw new Error('Scoring is still answering after the stop command')
      await sleep(250)
    }
  })
  await step(`Outage: close question ${q} -> 503 SCORING_UNAVAILABLE`, async () => {
    expect(await call('POST', room('/close-question'), state.host), 503, 'SCORING_UNAVAILABLE')
  })
  await step('Outage: question stays closed and unscored (answers 409 QUESTION_CLOSED, open 409, end 409)', async () => {
    const late = state.players[0]
    expect(await call('POST', room('/answers'), undefined, { sessionId: late.sessionId, optionIndex: 0 }), 409, 'QUESTION_CLOSED')
    expect(await call('POST', room('/open-question'), state.host), 409, 'INVALID_STATE')
    expect(await call('POST', room('/end'), state.host), 409, 'INVALID_STATE')
  })
  await step(`Outage: nothing was revealed for question ${q} on the relay`, async () => {
    await sleep(1500)
    for (const client of clients) {
      assert.ok(!client.events.some((e) => e.type === 'question:closed' && e.index === q), `${client.name} saw question:closed ${q}`)
      assert.equal(client.events.filter((e) => e.type === 'leaderboard:update').length, q, `${client.name} saw an extra leaderboard:update`)
    }
  })
  await step('Outage: restart Scoring on the same database file', async () => {
    execSync(START_SCORING, { stdio: 'ignore' })
    await waitForScoring()
    const results = expect(await call('GET', `${SCORING}/api/games/${state.roomId}/results`, state.host), 200)
    assert.equal(results.questionsScored, q, 'scored questions must survive the restart')
    checkStandings(results.scoreboard, q - 1)
  })
}

await step('Services are reachable', async () => {
  for (const url of [`${ACCOUNTS}/api/accounts/me`, `${LIBRARY}/api/quizzes`, `${SCORING}/api/games`, `${LGS}/api/rooms/ZZZZZZ`]) {
    const reply = await call('GET', url)
    assert.ok([401, 404].includes(reply.status), `${url} -> ${reply.status}`)
  }
})

await step('Accounts: register and log in host and second host', async () => {
  const tokens = []
  for (const who of ['host', 'other']) {
    const email = `${who}-${run}@example.test`
    expect(await call('POST', `${ACCOUNTS}/api/auth/register`, undefined, { email, password: 'e2e-password-1', displayName: who }), 201)
    const login = expect(await call('POST', `${ACCOUNTS}/api/auth/login`, undefined, { email, password: 'e2e-password-1' }), 200)
    assert.equal(login.tokenType, 'Bearer')
    tokens.push(login.accessToken)
  }
  ;[state.host, state.other] = tokens
  expect(await call('POST', `${ACCOUNTS}/api/auth/login`, undefined, { email: `host-${run}@example.test`, password: 'wrong-password' }), 401)
})

await step('Library: create a quiz', async () => {
  const quiz = expect(await call('POST', `${LIBRARY}/api/quizzes`, state.host, { title: `E2E Quiz ${run}` }), 201)
  assert.equal(quiz.ready, false)
  state.quizId = quiz.id
})

await step('Library: AI generation unavailable -> 503 and no questions saved', async () => {
  const notes = 'A 404 status means the requested resource was not found. HTTPS uses port 443.'
  expect(await call('POST', `${LIBRARY}/api/quizzes/${state.quizId}/generate`, state.host, { notes, count: 2 }), 503)
  const quiz = expect(await call('GET', `${LIBRARY}/api/quizzes/${state.quizId}`, state.host), 200)
  assert.equal(quiz.questions.length, 0)
  assert.equal(quiz.draftCount, 0)
})

await step('Library: add 3 questions as DRAFT', async () => {
  for (const question of QUESTIONS) {
    const created = expect(await call('POST', `${LIBRARY}/api/quizzes/${state.quizId}/questions`, state.host, question), 201)
    assert.equal(created.status, 'DRAFT')
    state.questionIds.push(created.id)
  }
})

await step('LGS: room for a quiz that is not ready -> 409 QUIZ_NOT_READY', async () => {
  expect(await call('POST', `${LGS}/api/rooms`, state.host, { quizId: state.quizId }), 409, 'QUIZ_NOT_READY')
})

await step('Library: approve the questions and the quiz is ready', async () => {
  for (const id of state.questionIds) {
    assert.equal(expect(await call('POST', `${LIBRARY}/api/quizzes/${state.quizId}/questions/${id}/approve`, state.host), 200).status, 'APPROVED')
  }
  const list = expect(await call('GET', `${LIBRARY}/api/quizzes`, state.host), 200)
  const summary = list.find((q: any) => q.id === state.quizId)
  assert.deepEqual([summary?.ready, summary?.approvedCount, summary?.draftCount], [true, 3, 0])
})

await step('LGS: second host cannot open a room for this quiz -> 404 QUIZ_NOT_FOUND', async () => {
  expect(await call('POST', `${LGS}/api/rooms`, state.other, { quizId: state.quizId }), 404, 'QUIZ_NOT_FOUND')
})

await step('LGS: no token -> 401 UNAUTHORIZED', async () => {
  expect(await call('POST', `${LGS}/api/rooms`, undefined, { quizId: state.quizId }), 401, 'UNAUTHORIZED')
})

await step('LGS: host creates a room', async () => {
  const body = expect(await call('POST', `${LGS}/api/rooms`, state.host, { quizId: state.quizId }), 201)
  assert.deepEqual(Object.keys(body).sort(), ['channel', 'joinKey', 'roomCode', 'roomId'])
  assert.equal(body.channel, `quizroom-${body.roomId}`)
  assert.match(body.roomCode, /^[A-HJ-NP-Z2-9]{6}$/)
  Object.assign(state, { roomId: body.roomId, code: body.roomCode, channel: body.channel, joinKey: body.joinKey })
})

await step('Library: editing question 0 after room creation (room keeps its snapshot)', async () => {
  const changed = { ...QUESTIONS[0], text: 'Edited after the room was created?' }
  const edited = expect(await call('PUT', `${LIBRARY}/api/quizzes/${state.quizId}/questions/${state.questionIds[0]}`, state.host, changed), 200)
  assert.equal(edited.status, 'DRAFT')
})

await step('LGS: invalid room code -> 404 ROOM_NOT_FOUND (GET and join)', async () => {
  expect(await call('GET', `${LGS}/api/rooms/0OIL10`), 404, 'ROOM_NOT_FOUND')
  expect(await call('POST', `${LGS}/api/rooms/0OIL10/players`, undefined, { nickname: 'Nobody' }), 404, 'ROOM_NOT_FOUND')
  assert.deepEqual(expect(await call('GET', `${LGS}/api/rooms/${state.code.toLowerCase()}`), 200), { status: 'LOBBY' })
})

await step('Relay: host connects to the channel (listen only)', async () => {
  state.hostClient = await listen('host', state.channel, { joinKey: state.joinKey })
})

await step('Relay: wrong joinKey is rejected', async () => {
  const intruder = connect(state.channel, { joinKey: 'wrong-key' } as IttySocketOptions)
  const outcome = await new Promise((resolve) => {
    intruder.on('open', () => resolve('open')).on('close', () => resolve('closed'))
    setTimeout(() => resolve('timeout'), WAIT_MS)
  })
  intruder.close()
  assert.equal(outcome, 'closed')
})

await step(`LGS: ${PLAYERS} players join concurrently over REST`, async () => {
  const replies = await Promise.all(
    Array.from({ length: PLAYERS }, (_, i) => call('POST', room('/players'), undefined, { nickname: `Player${String(i + 1).padStart(2, '0')}` })),
  )
  state.players = replies.map((reply, index) => {
    const body = expect(reply, 201)
    assert.deepEqual(Object.keys(body).sort(), ['channel', 'joinKey', 'participantId', 'sessionId'])
    assert.equal(body.channel, state.channel)
    return { nickname: `Player${String(index + 1).padStart(2, '0')}`, sessionId: body.sessionId, participantId: body.participantId, index }
  })
  assert.equal(new Set(state.players.map((p) => p.sessionId)).size, PLAYERS)
})

await step('LGS: duplicate nickname (other case) -> 409 NICKNAME_TAKEN', async () => {
  expect(await call('POST', room('/players'), undefined, { nickname: 'player01' }), 409, 'NICKNAME_TAKEN')
})

await step(`Relay: ${PLAYERS} players connect concurrently with announce`, async () => {
  await Promise.all(state.players.map((p) => listen(p.nickname, state.channel, { joinKey: state.joinKey, as: p.participantId, announce: true })))
})

await step(`Relay: host and every player see participants:update with ${PLAYERS} connected players`, async () => {
  await everyone('participants:update with all connected', (e) =>
    e.type === 'participants:update' && e.participants?.length === PLAYERS && e.participants.every((p: any) => p.connected === true))
})

await step('Relay: a player disconnecting and reconnecting updates the participant list for everyone', async () => {
  const leaver = state.players[PLAYERS - 1]
  const connectedIs = (value: boolean) => (e: any) =>
    e.type === 'participants:update' && e.participants?.find((p: any) => p.participantId === leaver.participantId)?.connected === value
  const index = clients.findIndex((c) => c.name === leaver.nickname)
  clients[index].socket.close()
  retired.push(...clients.splice(index, 1))
  await everyone(`${leaver.nickname} disconnected`, connectedIs(false))
  const marks = new Map(clients.map((c) => [c, c.events.length]))
  await listen(leaver.nickname, state.channel, { joinKey: state.joinKey, as: leaver.participantId, announce: true })
  await Promise.all(clients.map((c) => waitFor(c, `${leaver.nickname} reconnected`, connectedIs(true), marks.get(c))))
})

await step('Relay: a player cannot publish on the channel', async () => {
  const player = clients[1]
  player.socket.send({ type: 'question:closed', index: 0, correctIndex: 0 })
  await waitFor(player, 'send permission error', (e) => e.type === 'error')
  await sleep(500)
  assert.ok(!state.hostClient!.events.some((e) => e.type === 'question:closed'), 'forged event reached the host')
})

await step('LGS: open before start -> 409 INVALID_STATE', async () => {
  expect(await call('POST', room('/open-question'), state.host), 409, 'INVALID_STATE')
})

await step('LGS: second host starting the room -> 404 ROOM_NOT_FOUND', async () => {
  expect(await call('POST', room('/start'), state.other), 404, 'ROOM_NOT_FOUND')
})

await step('LGS: host starts the game; everyone receives game:started', async () => {
  assert.deepEqual(expect(await call('POST', room('/start'), state.host), 200), { status: 'IN_PROGRESS' })
  await everyone('game:started', (e) => e.type === 'game:started' && e.questionCount === QUESTIONS.length)
})

await step('LGS: invalid transitions after start (start twice, join, answer/close with nothing open)', async () => {
  expect(await call('POST', room('/start'), state.host), 409, 'INVALID_STATE')
  expect(await call('POST', room('/players'), undefined, { nickname: 'Latecomer' }), 409, 'ROOM_NOT_JOINABLE')
  expect(await call('POST', room('/answers'), undefined, { sessionId: state.players[0].sessionId, optionIndex: 0 }), 409, 'QUESTION_CLOSED')
  expect(await call('POST', room('/close-question'), state.host), 409, 'INVALID_STATE')
  expect(await call('POST', room('/answers'), undefined, { sessionId: state.players[0].sessionId, optionIndex: 7 }), 400, 'INVALID_REQUEST')
})

for (let q = 0; q < QUESTIONS.length; q++) await playQuestion(q)

await step('LGS: open past the last question -> 409 INVALID_STATE', async () => {
  expect(await call('POST', room('/open-question'), state.host), 409, 'INVALID_STATE')
})

await step('LGS: second host ending the room -> 404 ROOM_NOT_FOUND', async () => {
  expect(await call('POST', room('/end'), state.other), 404, 'ROOM_NOT_FOUND')
})

await step('LGS: host ends the game -> final results', async () => {
  const results = expect(await call('POST', room('/end'), state.host), 200)
  assert.equal(results.gameId, state.roomId)
  assert.equal(results.finished, true)
  assert.equal(results.questionsScored, QUESTIONS.length)
  assert.equal(results.quizTitle, `E2E Quiz ${run}`)
  checkStandings(results.scoreboard, QUESTIONS.length - 1)
  state.results = results
})

await step('Relay: every player and the host receive game:ended with the final scoreboard', async () => {
  const events = await everyone('game:ended', (e) => e.type === 'game:ended')
  for (const event of events) assert.deepEqual(event.scoreboard, state.results.scoreboard)
})

await step('LGS: ending again returns the same results; room is FINISHED', async () => {
  assert.deepEqual(expect(await call('POST', room('/end'), state.host), 200), state.results)
  assert.deepEqual(expect(await call('GET', room()), 200), { status: 'FINISHED' })
})

await step('Scoring: host reads stored results and they match', async () => {
  assert.deepEqual(expect(await call('GET', `${SCORING}/api/games/${state.roomId}/results`, state.host), 200), state.results)
})

await step('Scoring: GET /api/games lists the finished game', async () => {
  const games = expect(await call('GET', `${SCORING}/api/games`, state.host), 200)
  const game = games.find((g: any) => g.gameId === state.roomId)
  assert.ok(game, 'finished game missing from the list')
  assert.equal(game.playerCount, PLAYERS)
  assert.equal(game.quizTitle, `E2E Quiz ${run}`)
})

await step('Scoring: second host cannot see the results (404) or the game in its list', async () => {
  expect(await call('GET', `${SCORING}/api/games/${state.roomId}/results`, state.other), 404)
  const games = expect(await call('GET', `${SCORING}/api/games`, state.other), 200)
  assert.ok(!games.some((g: any) => g.gameId === state.roomId))
})

await step('Relay: no event ever contained a player sessionId', async () => {
  let total = 0
  for (const client of [...clients, ...retired]) {
    for (const event of client.events) {
      total++
      const raw = JSON.stringify(event)
      for (const p of state.players) assert.ok(!raw.includes(p.sessionId), `${client.name} saw ${p.nickname}'s sessionId in ${event.type}`)
    }
  }
  assert.ok(total > 0)
  console.log(`     checked ${total} relay events across ${clients.length + retired.length} connections`)
})

await finish(0)

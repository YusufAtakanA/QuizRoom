import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createResync, parseCode, type LiveEvent, type Snapshot } from './core.ts'

test('parseCode reads join links and bare codes', () => {
  assert.equal(parseCode('http://10.0.0.5:5173/#/join/ab12cd'), 'AB12CD')
  assert.equal(parseCode('https://x.test/#/join/QWERTY?x=1'), 'QWERTY')
  assert.equal(parseCode(' xyz789 '), 'XYZ789')
  assert.equal(parseCode('hello world'), null)
  assert.equal(parseCode('ABC12'), null)
  assert.equal(parseCode('https://example.com/'), null)
})

const full = (eventId: number): Snapshot => ({
  status: 'LOBBY',
  eventId,
  questionCount: 1,
  participants: [],
  question: null,
  open: false,
  reveal: null,
  leaderboard: [],
  scoreboard: null,
})
const ev = (eventId: number): LiveEvent => ({ type: 'game:started', questionCount: 1, eventId })

test('resync drops stale events and refetches on a gap', async () => {
  const seen: number[] = []
  const applied: number[] = []
  const queue: Snapshot[] = [full(2), full(5)]
  let fetches = 0
  const sync = createResync(
    async () => (fetches++, queue.shift() ?? null),
    (s) => applied.push(s.eventId ?? -1),
    (e) => seen.push(e.eventId ?? -1),
  )
  await sync.snapshot()
  assert.deepEqual(applied, [2])
  sync.event(ev(1))
  sync.event(ev(2))
  sync.event(ev(3))
  sync.event({ type: 'game:started', questionCount: 1 })
  assert.deepEqual(seen, [3])
  assert.equal(fetches, 1)
  sync.event(ev(5))
  assert.deepEqual(seen, [3, 5])
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(fetches, 2)
  assert.deepEqual(applied, [2, 5])
})

test('an older snapshot is refetched once, then dropped', async () => {
  const applied: number[] = []
  const queue: Snapshot[] = [full(1), full(1)]
  let fetches = 0
  const sync = createResync(
    async () => (fetches++, queue.shift() ?? null),
    (s) => applied.push(s.eventId ?? -1),
    () => {},
  )
  sync.event(ev(3))
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(fetches, 2)
  assert.deepEqual(applied, [])
  queue.push({ status: 'FINISHED' })
  await sync.snapshot()
  assert.deepEqual(applied, [-1])
})

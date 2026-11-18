import { afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { openChannel } from '../src/relay.ts'

class FakeSocket {
  static all: FakeSocket[] = []
  readyState = 0
  sent: string[] = []
  url: string
  onopen?: () => void
  onclose?: () => void
  onmessage?: (event: { data: string }) => void
  constructor(url: string) {
    this.url = url
    FakeSocket.all.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  accept() {
    this.readyState = 1
    this.onopen?.()
  }
  drop() {
    this.readyState = 3
    this.onclose?.()
  }
  close() {
    this.drop()
  }
}

const realSocket = globalThis.WebSocket

beforeEach(() => {
  FakeSocket.all = []
  ;(globalThis as any).WebSocket = FakeSocket
  mock.timers.enable({ apis: ['setTimeout'] })
  mock.method(console, 'error', () => {})
  mock.method(Math, 'random', () => 0.5)
})

afterEach(() => {
  globalThis.WebSocket = realSocket
  mock.timers.reset()
  mock.restoreAll()
})

const options = (joined: string[]) => ({
  channel: 'quizroom-test',
  joinKey: 'join',
  sendKey: 'send',
  onJoin: (alias: string) => joined.push(alias),
  onLeave: () => {},
})

test('a dropped relay connection reconnects with the same keys and delivers queued events', async () => {
  const joined: string[] = []
  const pending = openChannel(options(joined))
  FakeSocket.all[0].accept()
  const channel = await pending
  assert.match(FakeSocket.all[0].url, /quizroom-test\?joinKey=join&sendKey=send$/)
  FakeSocket.all[0].drop()
  channel.publish('question:opened', { index: 0 })
  assert.equal(FakeSocket.all.length, 2)
  FakeSocket.all[1].drop()
  mock.timers.tick(1000)
  assert.equal(FakeSocket.all.length, 3)
  assert.equal(FakeSocket.all[2].url, FakeSocket.all[0].url)
  FakeSocket.all[2].accept()
  assert.deepEqual(JSON.parse(FakeSocket.all[2].sent[0]), { index: 0, type: 'question:opened' })
  FakeSocket.all[2].onmessage?.({ data: JSON.stringify({ type: 'join', alias: 'pid-1' }) })
  assert.deepEqual(joined, ['pid-1'])
  channel.close()
  mock.timers.tick(5000)
  assert.equal(FakeSocket.all.length, 3)
})

test('reconnects use capped exponential backoff with full jitter and reset after a successful open', async () => {
  const pending = openChannel(options([]))
  FakeSocket.all[0].accept()
  await pending
  const expectReconnectAfter = (delay: number) => {
    const before = FakeSocket.all.length
    FakeSocket.all.at(-1)!.drop()
    mock.timers.tick(delay - 1)
    assert.equal(FakeSocket.all.length, before, `reconnected before ${delay} ms`)
    mock.timers.tick(1)
    assert.equal(FakeSocket.all.length, before + 1, `no reconnect after ${delay} ms`)
  }
  for (const delay of [500, 1000, 2000, 4000, 8000, 15000, 15000]) expectReconnectAfter(delay)
  FakeSocket.all.at(-1)!.accept()
  expectReconnectAfter(500)
})

test('publishing during an outage keeps a single backoff chain', async () => {
  const pending = openChannel(options([]))
  FakeSocket.all[0].accept()
  const channel = await pending
  FakeSocket.all[0].drop()
  channel.publish('answers:count', { submitted: 1 })
  FakeSocket.all[1].drop()
  channel.publish('answers:count', { submitted: 2 })
  FakeSocket.all[2].drop()
  mock.timers.tick(1999)
  assert.equal(FakeSocket.all.length, 3)
  mock.timers.tick(1)
  assert.equal(FakeSocket.all.length, 4)
  FakeSocket.all[3].drop()
  mock.timers.tick(30000)
  assert.equal(FakeSocket.all.length, 5)
  channel.close()
})

test('a rejected first connection rejects without reconnecting', async () => {
  const pending = openChannel(options([]))
  FakeSocket.all[0].drop()
  await assert.rejects(pending)
  mock.timers.tick(5000)
  assert.equal(FakeSocket.all.length, 1)
})

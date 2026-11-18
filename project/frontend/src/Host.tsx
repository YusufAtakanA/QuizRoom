import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { ApiError, api, errorText, go, load, save, useLoad } from './api'
import type { CSSProperties } from 'react'
import {
  Board,
  Capsule,
  LETTERS,
  People,
  Podium,
  SHAPES,
  Skeleton,
  useLive,
  useMoves,
  useResync,
  type Count,
  type OpenQuestion,
  type Participant,
  type Reveal,
  type Snapshot,
  type Standing,
} from './live'
import type { HostRoom } from './Library'

type Phase = 'loading' | 'lobby' | 'waiting' | 'open' | 'closed' | 'unknown' | 'ended' | 'gone'
type Action = 'start' | 'open-question' | 'close-question' | 'end'

const joinLink = (code: string) => `${__PUBLIC_ORIGIN__ || location.origin}/#/join/${code}`

function JoinPanel({ code, compact }: { code: string; compact: boolean }) {
  const link = joinLink(code)
  const [copied, setCopied] = useState('')

  function copy() {
    const writing = navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject(new Error('no clipboard'))
    writing.then(
      () => setCopied('Link copied.'),
      () => setCopied('Could not copy automatically. Select the link and copy it.'),
    )
  }

  return (
    <div className={compact ? 'join-panel compact' : 'join-panel'}>
      <div className="qr">
        <QRCodeSVG value={link} size={compact ? 96 : 240} marginSize={2} bgColor="#ffffff" fgColor="#000000" role="img" title="QR code that opens the join page" />
      </div>
      <div className="join-info">
        <p className="muted">{compact ? 'Join with code' : 'Scan with a phone camera, or join with code'}</p>
        <p className="room-code">
          <span className="visually-hidden">Room code {code.split('').join(' ')}</span>
          <span aria-hidden="true">{code}</span>
        </p>
        <div className={compact ? 'copy visually-hidden' : 'copy'}>
          <label htmlFor="join-link">Join link</label>
          <div className="copy-row">
            <input id="join-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="secondary" onClick={copy}>
              Copy
            </button>
          </div>
        </div>
        <p role="status" className="hint copied">
          {copied && copied.startsWith('Link') && (
            <span className="ok-glyph" aria-hidden="true">
              ✓{' '}
            </span>
          )}
          {copied}
        </p>
      </div>
    </div>
  )
}

export function HostGame() {
  const [room] = useState(() => load<HostRoom>('qr.hostRoom'))
  const [phase, setPhase] = useState<Phase>('loading')
  const [participants, setParticipants] = useState<Participant[]>([])
  const [questionCount, setQuestionCount] = useState<number | null>(null)
  const [question, setQuestion] = useState<OpenQuestion | null>(null)
  const [count, setCount] = useState<Count | null>(null)
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [leaderboard, setLeaderboard] = useState<Standing[]>([])
  const [scoreboard, setScoreboard] = useState<Standing[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState<Action | null>(null)
  const [ending, setEnding] = useState(false)
  const [celebrate, setCelebrate] = useState(false)
  const moves = useMoves(leaderboard)
  const code = room?.roomCode ?? ''

  const sync = useResync(snapshot, apply, (event) => {
    if (event.type === 'participants:update') setParticipants(event.participants)
    if (event.type === 'game:started') setQuestionCount(event.questionCount)
    if (event.type === 'question:opened') {
      setQuestion(event)
      setReveal(null)
      setPhase('open')
    }
    if (event.type === 'answers:count') setCount(event)
    if (event.type === 'question:closed') setReveal(event)
    if (event.type === 'leaderboard:update') setLeaderboard(event.leaderboard)
    if (event.type === 'game:ended') {
      setScoreboard(event.scoreboard)
      setPhase('ended')
      setCelebrate(true)
    }
  })
  const connected = useLive(phase === 'ended' || phase === 'gone' ? undefined : room?.channel, room?.joinKey, undefined, sync.event, sync.snapshot)

  function snapshot() {
    if (!room) return Promise.resolve(null)
    return api<Snapshot>('GET', `/api/rooms/${encodeURIComponent(room.roomCode)}`).catch((e) => {
      if (e instanceof ApiError && e.code === 'ROOM_NOT_FOUND') {
        setError(errorText(e))
        setPhase('gone')
      } else if (phase === 'loading') {
        setError(errorText(e))
        setPhase('unknown')
      }
      return null
    })
  }

  function apply(s: Snapshot) {
    if (s.eventId === undefined) {
      if (phase !== 'loading') return
      if (s.status === 'LOBBY') setPhase('lobby')
      else if (s.status === 'IN_PROGRESS') setPhase('unknown')
      else act('end')
      return
    }
    setParticipants(s.participants)
    setQuestionCount(s.questionCount)
    setQuestion(s.question)
    setCount(s.answers)
    setReveal(s.reveal)
    setLeaderboard(s.leaderboard)
    setScoreboard(s.scoreboard ?? [])
    setPhase(s.status === 'LOBBY' ? 'lobby' : s.status === 'FINISHED' ? 'ended' : !s.question ? 'waiting' : s.reveal ? 'closed' : 'open')
  }

  async function act(action: Action) {
    setBusy(true)
    setError('')
    setRetry(null)
    try {
      const res = await api<{ index: number; leaderboard: Standing[]; scoreboard: Standing[] }>(
        'POST',
        `/api/rooms/${encodeURIComponent(code)}/${action}`,
      )
      if (action === 'start') setPhase('waiting')
      if (action === 'open-question') {
        setQuestion((q) => (q?.index === res.index ? q : null))
        setReveal((v) => (v?.index === res.index ? v : null))
        setCount((c) => (c?.index === res.index ? c : null))
        setPhase('open')
      }
      if (action === 'close-question') {
        setLeaderboard(res.leaderboard)
        setPhase('closed')
      }
      if (action === 'end') {
        setScoreboard(res.scoreboard)
        setPhase('ended')
        if (phase !== 'loading') setCelebrate(true)
      }
    } catch (e) {
      setError(errorText(e))
      if (e instanceof ApiError && e.code === 'SCORING_UNAVAILABLE') setRetry(action)
      if (e instanceof ApiError && e.code === 'SCORING_UNAVAILABLE' && action === 'end') setEnding(true)
      if (e instanceof ApiError && e.code === 'ROOM_NOT_FOUND') setPhase('gone')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!room) return go('/quizzes')
    sync.snapshot()
  }, [])

  useEffect(() => {
    if (phase === 'ended' || phase === 'gone') save('qr.hostRoom', null)
  }, [phase])

  if (!room) return null

  const index = question?.index ?? -1
  const lastQuestion = questionCount !== null && index + 1 >= questionCount
  const canOpen = (phase === 'waiting' || phase === 'closed' || phase === 'unknown') && !lastQuestion && !ending
  const canClose = (phase === 'open' || phase === 'unknown') && !ending
  const canEnd = phase === 'waiting' || phase === 'closed' || phase === 'unknown'

  const leave = () => go('/quizzes')
  const over = phase === 'ended' || phase === 'gone'
  const revealed = reveal !== null && reveal.index === question?.index
  const finalStep = phase === 'closed' && lastQuestion
  const lobby = phase === 'lobby' || phase === 'loading'
  const players = participants.length

  return (
    <section className="host">
      <div className="row title-row">
        <h1 className="grow">{room.quizTitle}</h1>
        <Capsule tone={connected ? 'live' : phase === 'ended' ? 'done' : phase === 'gone' ? 'off' : 'wait'}>
          {connected ? 'Live' : phase === 'ended' ? 'Finished' : phase === 'gone' ? 'Offline' : 'Connecting…'}
        </Capsule>
      </div>

      <div role="status" aria-live="polite" className="status-line">
        {phase === 'lobby' && 'Waiting in the lobby. Start the game when everyone has joined.'}
        {phase === 'waiting' && `Game started${questionCount ? ` with ${questionCount} questions` : ''}. Open the first question.`}
        {phase === 'open' && count?.index === index && `${count.submitted} of ${count.total} players answered.`}
        {phase === 'open' && count?.index !== index && 'Question open. Waiting for answers.'}
        {phase === 'closed' && (lastQuestion ? 'That was the last question. End the game to see the final scoreboard.' : 'Answering closed.')}
        {phase === 'unknown' && 'Game in progress. Continue where you left off.'}
        {phase === 'ended' && 'The game has ended.'}
        {phase === 'gone' && 'This room no longer exists.'}
      </div>

      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          {phase === 'gone' && <p>Scores are saved if the game finished.</p>}
          {retry && (
            <button type="button" onClick={() => act(retry)} disabled={busy}>
              Retry
            </button>
          )}
        </div>
      )}

      {!over && phase !== 'loading' && (
        <div className="actions controls">
          {phase === 'lobby' && (
            <button type="button" onClick={() => act('start')} disabled={busy}>
              Start game <span aria-hidden="true">·</span> {players} player{players === 1 ? '' : 's'}
            </button>
          )}
          {canOpen && (
            <button type="button" onClick={() => act('open-question')} disabled={busy}>
              {phase === 'unknown' ? 'Open next question' : `Open question ${index + 2}`}
            </button>
          )}
          {canClose && (
            <button type="button" onClick={() => act('close-question')} disabled={busy}>
              {phase === 'unknown' ? 'Close answering' : 'Close answering and reveal'}
            </button>
          )}
          {canEnd && (
            <button type="button" className={finalStep ? 'end' : 'plain end'} onClick={() => act('end')} disabled={busy}>
              {finalStep ? 'End game and show podium' : 'End game'}
            </button>
          )}
        </div>
      )}

      {!over && (
        <div className="host-grid">
          <div className="stage">
            {lobby && <JoinPanel code={code} compact={false} />}
            {question && !lobby && (
              <div className="qa" key={question.index}>
                <h2 className="q-count">
                  Question {question.index + 1}
                  {questionCount ? ` of ${questionCount}` : ''}
                </h2>
                <p className="display question-text">{question.text}</p>
                <ul className={`answers tiles${revealed ? ' revealed' : ''}${question.options.some((o) => o.length > 60) ? ' long' : ''}`}>
                  {question.options.map((option, i) => {
                    const correct = revealed && reveal.correctIndex === i
                    return (
                      <li key={i} className={correct ? `a${i} correct` : `a${i}`} style={{ '--i': i } as CSSProperties}>
                        <span className="letter">{LETTERS[i]}</span>
                        <span className="answer-text">{option}</span>
                        <span className="shape" aria-hidden="true">
                          {SHAPES[i]}
                        </span>
                        {correct && (
                          <span className="tag">
                            <span aria-hidden="true">✓ </span>Correct answer
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
                {phase === 'open' && (
                  <div className="meter" aria-hidden="true">
                    <span style={{ transform: `scaleX(${count?.index === index && count.total ? count.submitted / count.total : 0})` }} />
                  </div>
                )}
                {revealed && reveal.explanation && (
                  <p className="callout explanation">
                    <strong>Explanation:</strong> {reveal.explanation}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="side">
            {phase === 'closed' && <Board rows={leaderboard} title="Leaderboard" moves={moves} limit={8} />}
            {!lobby && <JoinPanel code={code} compact />}
            <div className="card players">
              <h2>
                Players <span className="count">{players}</span>
              </h2>
              <div aria-live="polite">
                <People
                  participants={participants}
                  empty={
                    <>
                      No one here yet. Scan the code or go to <span className="mono">{joinLink(code).replace(/^https?:\/\//, '').split('/')[0]}</span> and type{' '}
                      <span className="mono">{code}</span>.
                    </>
                  }
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === 'ended' && (
        <div className="ended">
          <Podium rows={scoreboard} animate={celebrate} />
          <Board rows={scoreboard} title="Final scoreboard" />
          <div className="actions">
            <a className="button" href={`#/results/${room.roomId}`}>
              View stored results
            </a>
            <button type="button" className="secondary" onClick={leave}>
              Back to quizzes
            </button>
          </div>
        </div>
      )}
      {phase === 'gone' && (
        <button type="button" onClick={leave}>
          Back to quizzes
        </button>
      )}
    </section>
  )
}

type GameSummary = { gameId: string; quizTitle: string; finishedAt: string; playerCount: number }
type Results = {
  gameId: string
  quizTitle: string
  finished: boolean
  finishedAt: string | null
  questionsScored: number
  scoreboard: Standing[]
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'not finished')

export function GameList() {
  const { data, error } = useLoad<GameSummary[]>('/api/games')
  return (
    <section>
      <h1>Past results</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data === null && !error && <Skeleton kind="row" />}
      {data?.length === 0 && (
        <div className="empty">
          <p className="muted">No finished games yet. Host a quiz and its results will appear here.</p>
          <a className="button secondary" href="#/quizzes">
            Go to quizzes
          </a>
        </div>
      )}
      {data && data.length > 0 && (
        <table className="board rows">
          <caption className="visually-hidden">Finished games, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Quiz</th>
              <th scope="col">Finished</th>
              <th scope="col">Players</th>
            </tr>
          </thead>
          <tbody>
            {data.map((g) => (
              <tr key={g.gameId}>
                <td>
                  <a href={`#/results/${g.gameId}`}>{g.quizTitle}</a>
                </td>
                <td>{when(g.finishedAt)}</td>
                <td>{g.playerCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

export function GameResults({ gameId }: { gameId: string }) {
  const { data, error } = useLoad<Results>(`/api/games/${encodeURIComponent(gameId)}/results`)
  return (
    <section>
      <p className="back">
        <a href="#/results">
          <span className="chevron" aria-hidden="true" />
          Results
        </a>
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data === null && !error && <Skeleton kind="row" />}
      {data && (
        <>
          <h1>{data.quizTitle}</h1>
          <p className="meta">
            Finished {when(data.finishedAt)}. {data.questionsScored} question{data.questionsScored === 1 ? '' : 's'} scored.
          </p>
          <Podium rows={data.scoreboard} animate={false} />
          <Board rows={data.scoreboard} title="Final scoreboard" />
        </>
      )}
    </section>
  )
}

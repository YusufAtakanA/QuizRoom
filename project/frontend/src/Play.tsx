import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api, errorText, go, load, save } from './api'
import type { CSSProperties } from 'react'
import {
  Board,
  BusyLabel,
  Capsule,
  LETTERS,
  People,
  Podium,
  SHAPES,
  ordinal,
  reducedMotion,
  useLive,
  useMoves,
  useResync,
  type OpenQuestion,
  type Participant,
  type Reveal,
  type Snapshot,
  type Standing,
} from './live'

function nudge(el: HTMLElement) {
  if (reducedMotion() || !el.animate) return
  el.animate(
    [{ transform: 'none' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }],
    { duration: 280, easing: 'ease-out' },
  )
}

type Player = { roomCode: string; sessionId: string; participantId: string; channel: string; joinKey: string; nickname: string }
type Phase = 'loading' | 'lobby' | 'waiting' | 'question' | 'ended' | 'gone'

const roomPath = (code: string) => `/api/rooms/${encodeURIComponent(code)}`

export function Join({ code = '' }: { code?: string }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [codeBad, setCodeBad] = useState(false)
  const current = load<Player>('qr.player')

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const el = e.currentTarget
    const form = new FormData(el)
    const roomCode = String(form.get('code')).trim().toUpperCase()
    const nickname = String(form.get('nickname')).trim()
    const valid = el.checkValidity()
    setError(nickname ? '' : 'Please enter a nickname.')
    if (!valid || !nickname) return el.querySelector<HTMLElement>(':invalid, #nickname')?.focus()
    setBusy(true)
    setError('')
    try {
      const joined = await api<Omit<Player, 'roomCode' | 'nickname'>>(
        'POST',
        `${roomPath(roomCode)}/players`,
        { nickname },
        false,
      )
      save('qr.player', { ...joined, roomCode, nickname })
      go('/play')
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <section className="narrow">
      <h1 id="join-title">Join a game</h1>
      <p className="lead">Enter the code on the host's screen, or scan its QR code with your phone camera.</p>
      {current && (
        <div className="notice">
          <p>
            You're in room {current.roomCode} as {current.nickname}.
          </p>
          <a className="button secondary" href="#/play">
            Back to the game
          </a>
        </div>
      )}
      <form className="card" onSubmit={submit} aria-labelledby="join-title" aria-busy={busy} noValidate>
        <label htmlFor="code">Room code</label>
        <p id="code-hint" className="hint">
          6 letters or digits, shown on the host's screen.
        </p>
        <input
          id="code"
          name="code"
          className="code-input"
          required
          minLength={6}
          maxLength={6}
          pattern="[A-Za-z0-9]{6}"
          title="6 letters or digits"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          defaultValue={code.toUpperCase()}
          aria-invalid={codeBad}
          aria-describedby={codeBad ? 'code-hint code-error' : 'code-hint'}
          onBlur={(e) => {
            const bad = e.currentTarget.matches(':user-invalid')
            if (bad && !codeBad) nudge(e.currentTarget)
            setCodeBad(bad)
          }}
          onInput={(e) => codeBad && setCodeBad(e.currentTarget.matches(':user-invalid'))}
          onInvalid={(e) => {
            nudge(e.currentTarget)
            setCodeBad(true)
          }}
        />
        {codeBad && (
          <p id="code-error" className="field-error">
            Error: enter the 6-character room code (letters or digits), for example AB12CD.
          </p>
        )}
        <label htmlFor="nickname">Nickname</label>
        <p id="nick-hint" className="hint">
          Up to 20 characters. Other players will see it.
        </p>
        <input
          id="nickname"
          name="nickname"
          required
          maxLength={20}
          autoComplete="nickname"
          enterKeyHint="go"
          aria-describedby="nick-hint"
          autoFocus={code !== ''}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="big" disabled={busy}>
          <BusyLabel busy={busy} idle="Join" active="Joining…" />
        </button>
      </form>
      <p className="center foot">
        Hosting a quiz? <a href="#/login">Log in as a host</a>
      </p>
    </section>
  )
}

export function Play() {
  const [me] = useState(() => load<Player>('qr.player'))
  const [phase, setPhase] = useState<Phase>('loading')
  const [participants, setParticipants] = useState<Participant[]>([])
  const [questionCount, setQuestionCount] = useState<number | null>(null)
  const [question, setQuestion] = useState<OpenQuestion | null>(null)
  const [choice, setChoice] = useState<number | null>(null)
  const [locked, setLocked] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [leaderboard, setLeaderboard] = useState<Standing[]>([])
  const [scoreboard, setScoreboard] = useState<Standing[]>([])
  const [message, setMessage] = useState('')
  const [celebrate, setCelebrate] = useState(false)
  const moves = useMoves(leaderboard)

  const sync = useResync(snapshot, apply, (event) => {
    if (event.type === 'participants:update') setParticipants(event.participants)
    if (event.type === 'game:started') {
      setQuestionCount(event.questionCount)
      setPhase('waiting')
    }
    if (event.type === 'question:opened') {
      setQuestion(event)
      setChoice(null)
      setLocked(false)
      setAccepted(false)
      setReveal(null)
      setMessage('')
      setPhase('question')
    }
    if (event.type === 'question:closed') {
      setReveal(event)
      setLocked(true)
    }
    if (event.type === 'leaderboard:update') setLeaderboard(event.leaderboard)
    if (event.type === 'game:ended') {
      setScoreboard(event.scoreboard)
      setPhase('ended')
      setCelebrate(true)
    }
  })
  const connected = useLive(phase === 'ended' || phase === 'gone' ? undefined : me?.channel, me?.joinKey, me?.participantId, sync.event, sync.snapshot)

  function snapshot() {
    if (!me) return Promise.resolve(null)
    return api<Snapshot>('GET', roomPath(me.roomCode), undefined, false, { 'X-Session-Id': me.sessionId }).catch((e) => {
      if (e instanceof ApiError && e.status === 404) {
        setMessage(errorText(e))
        setPhase('gone')
      } else if (phase === 'loading') {
        setMessage(errorText(e))
        setPhase('lobby')
      }
      return null
    })
  }

  function apply(s: Snapshot) {
    if (s.eventId === undefined) {
      if (phase === 'loading') setPhase(s.status === 'LOBBY' ? 'lobby' : s.status === 'IN_PROGRESS' ? 'waiting' : 'ended')
      return
    }
    setParticipants(s.participants)
    setQuestionCount(s.questionCount)
    setLeaderboard(s.leaderboard)
    setScoreboard(s.scoreboard ?? [])
    if (s.question && s.question.index !== question?.index) {
      setChoice(null)
      setLocked(false)
      setAccepted(false)
      setMessage('')
    }
    if (s.question && !s.open) setLocked(true)
    if (s.question && s.myAnswer != null) {
      setChoice(s.myAnswer)
      setLocked(true)
      setAccepted(true)
    }
    setQuestion(s.question)
    setReveal(s.reveal)
    setPhase(s.status === 'LOBBY' ? 'lobby' : s.status === 'FINISHED' ? 'ended' : s.question ? 'question' : 'waiting')
  }

  useEffect(() => {
    if (!me) return go('/')
    sync.snapshot()
  }, [])

  useEffect(() => {
    if (phase === 'ended' || phase === 'gone') save('qr.player', null)
  }, [phase])

  if (!me) return null

  async function answer(optionIndex: number) {
    if (!me || locked) return
    setChoice(optionIndex)
    setLocked(true)
    setMessage('')
    try {
      await api('POST', `${roomPath(me.roomCode)}/answers`, { sessionId: me.sessionId, optionIndex }, false)
      setAccepted(true)
    } catch (e) {
      const code = e instanceof ApiError ? e.code : ''
      setMessage(errorText(e))
      if (code === 'ALREADY_ANSWERED') {
        setChoice(null)
        setAccepted(true)
        sync.snapshot()
      }
      else if (code === 'NOT_IN_ROOM' || code === 'ROOM_NOT_FOUND') setPhase('gone')
      else if (code === 'QUESTION_CLOSED') setChoice(null)
      else {
        setChoice(null)
        setLocked(false)
      }
    }
  }

  function leave() {
    save('qr.player', null)
    go('/')
  }

  const revealed = reveal !== null && reveal.index === question?.index
  const myRow = leaderboard.find((r) => r.playerId === me.participantId)
  const myFinal = scoreboard.find((r) => r.playerId === me.participantId)
  const tied = myRow !== undefined && leaderboard.filter((r) => r.rank === myRow.rank).length > 1
  const outcome = !revealed ? '' : !accepted || choice === null ? 'none' : choice === reveal.correctIndex ? 'ok' : 'bad'

  return (
    <section className="play">
      <div className="row player-bar">
        <p className="grow">
          <strong className="nick">{me.nickname}</strong> <span className="room mono">Room {me.roomCode}</span>
        </p>
        <Capsule tone={connected ? 'live' : phase === 'ended' ? 'done' : phase === 'gone' ? 'off' : 'wait'}>
          {connected ? 'Connected' : phase === 'ended' ? 'Finished' : phase === 'gone' ? 'Offline' : 'Connecting…'}
        </Capsule>
      </div>

      {message && (
        <p className={phase === 'gone' ? 'error' : 'notice'} role="alert">
          {message}
        </p>
      )}

      {phase === 'gone' && (
        <button type="button" className="big" onClick={leave}>
          Join another game
        </button>
      )}

      {(phase === 'lobby' || phase === 'waiting') && (
        <div className="waiting">
          <h1 className="hero">{phase === 'lobby' ? `You're in, ${me.nickname}!` : 'Get ready'}</h1>
          <p role="status" aria-live="polite" className="status-line">
            {phase === 'lobby'
              ? 'Waiting for the host to start the game.'
              : `The game is on${questionCount ? ` (${questionCount} question${questionCount === 1 ? '' : 's'})` : ''}. Waiting for the next question.`}
          </p>
          <div className="card">
            <h2>
              Players <span className="count">{participants.length}</span>
            </h2>
            <div aria-live="polite">
              <People participants={participants} me={me.participantId} />
            </div>
          </div>
        </div>
      )}

      {phase === 'question' && question && (
        <div className="qa">
          <h1 className="question-title" key={`q${question.index}`}>
            <span className="q-count">
              Question {question.index + 1}
              {questionCount ? ` of ${questionCount}` : ''}
            </span>
            <span className="question-text">{question.text}</span>
          </h1>
          <div
            key={`a${question.index}`}
            className={`answers${locked ? ' is-locked' : ''}${question.options.some((o) => o.length > 60) ? ' long' : ''}`}
            role="group"
            aria-label="Answers"
          >
            {question.options.map((option, i) => {
              const correct = revealed && reveal.correctIndex === i
              const wrongPick = revealed && accepted && choice === i && !correct
              return (
                <button
                  key={i}
                  type="button"
                  className={`answer a${i}${choice === i ? ' chosen' : ''}${choice === i && accepted ? ' locked' : ''}${correct ? ' correct' : ''}${wrongPick ? ' wrong' : ''}`}
                  style={{ '--i': i } as CSSProperties}
                  aria-pressed={choice === i}
                  disabled={locked && choice !== i && !correct}
                  aria-disabled={locked || undefined}
                  onClick={() => answer(i)}
                >
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
                  {wrongPick && (
                    <span className="tag">
                      <span aria-hidden="true">✕ </span>Your answer
                    </span>
                  )}
                  {choice === i && !revealed && (
                    <span className="tag" key={accepted ? 'locked' : 'sending'}>
                      {accepted ? 'Locked in' : 'Sending…'}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div role="status" aria-live="polite" className={outcome ? `status-line outcome ${outcome}` : 'status-line'}>
            {outcome && (
              <span className="outcome-icon" aria-hidden="true">
                {outcome === 'ok' ? '✓' : outcome === 'bad' ? '✕' : '–'}
              </span>
            )}
            {!revealed && accepted && 'Locked in. Waiting for the host to close answering.'}
            {!revealed && !accepted && locked && choice !== null && !message && 'Sending your answer…'}
            {!revealed && !locked && "Pick one answer. You can't change it after you tap."}
            {revealed &&
              (!accepted
                ? "You didn't answer this one."
                : choice === null
                  ? 'Your first answer was counted. See the leaderboard.'
                  : choice === reveal.correctIndex
                    ? 'Correct! You earned 1 point.'
                    : (
                      <>
                        Not this time. The answer was {LETTERS[reveal.correctIndex]}
                        {' '}
                        <span aria-hidden="true">{SHAPES[reveal.correctIndex]}</span> {question.options[reveal.correctIndex]}.
                      </>
                    ))}
          </div>
          {revealed && reveal.explanation && (
            <p className="card explanation">
              <strong>Explanation:</strong> {reveal.explanation}
            </p>
          )}
          {revealed && (
            <>
              {myRow && (
                <div className="card rank-card">
                  <p className="rank-big" aria-hidden="true">
                    {ordinal(myRow.rank)} <span>·</span> {myRow.score} point{myRow.score === 1 ? '' : 's'}
                  </p>
                  <p className="muted">
                    You are {tied ? 'tied for ' : ''}
                    {ordinal(myRow.rank)} with {myRow.score} point{myRow.score === 1 ? '' : 's'}.
                  </p>
                </div>
              )}
              <Board rows={leaderboard} me={me.participantId} title="Leaderboard" moves={moves} />
            </>
          )}
        </div>
      )}

      {phase === 'ended' && (
        <div className="ended">
          <h1>Game over</h1>
          {myFinal && (
            <p className="lead">
              You finished {scoreboard.filter((r) => r.rank === myFinal.rank).length > 1 ? 'tied for ' : ''}
              {ordinal(myFinal.rank)} with {myFinal.score} point{myFinal.score === 1 ? '' : 's'}.
            </p>
          )}
          {scoreboard.length > 0 ? (
            <>
              <Podium rows={scoreboard} animate={celebrate} />
              <Board rows={scoreboard} me={me.participantId} title="Final scoreboard" />
            </>
          ) : (
            <p className="muted">The game has ended.</p>
          )}
          <button type="button" className="big" onClick={leave}>
            Join another game
          </button>
        </div>
      )}
    </section>
  )
}

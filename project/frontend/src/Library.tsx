import { useState, type FormEvent } from 'react'
import { ApiError, api, errorText, go, load, save, useLoad } from './api'
import { BusyLabel, Capsule, LETTERS, SHAPES, Skeleton } from './live'

type QuizSummary = { id: string; title: string; approvedCount: number; draftCount: number; ready: boolean }
type Question = {
  id: string
  text: string
  options: string[]
  correctIndex: number
  explanation: string | null
  sourceExcerpt: string | null
  status: 'DRAFT' | 'APPROVED'
}
type Quiz = QuizSummary & { notes: string | null; questions: Question[] }
export type HostRoom = { roomId: string; roomCode: string; channel: string; joinKey: string; quizTitle: string }

function Ready({ ready }: { ready: boolean }) {
  return <Capsule tone={ready ? 'ready' : 'plain'}>{ready ? 'Ready' : 'Needs approved questions'}</Capsule>
}

function Counts({ quiz }: { quiz: QuizSummary }) {
  return (
    <span className="meta">
      {quiz.approvedCount} approved, {quiz.draftCount} draft
    </span>
  )
}

export function Library() {
  const { data, error, reload } = useLoad<QuizSummary[]>('/api/quizzes')
  const [message, setMessage] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const live = load<HostRoom>('qr.hostRoom')

  async function run(action: () => Promise<unknown>) {
    setMessage('')
    try {
      await action()
      await reload()
    } catch (e) {
      setMessage(errorText(e))
    }
  }

  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const title = String(new FormData(form).get('title')).trim()
    run(async () => {
      const quiz = await api<Quiz>('POST', '/api/quizzes', { title })
      form.reset()
      go(`/quizzes/${quiz.id}`)
    })
  }

  function rename(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault()
    const title = String(new FormData(e.currentTarget).get('title')).trim()
    run(async () => {
      await api('PUT', `/api/quizzes/${id}`, { title })
      setRenaming(null)
    })
  }

  async function host(quiz: QuizSummary) {
    setMessage('')
    try {
      const room = await api<Omit<HostRoom, 'quizTitle'>>('POST', '/api/rooms', { quizId: quiz.id })
      save('qr.hostRoom', { ...room, quizTitle: quiz.title })
      go('/host')
    } catch (e) {
      setMessage(errorText(e))
    }
  }

  return (
    <section>
      <h1>Your quizzes</h1>
      {live && (
        <div className="notice">
          <p>A game is live in room {live.roomCode}.</p>
          <a className="button" href="#/host">
            Return to room
          </a>
        </div>
      )}
      <form className="card inline" onSubmit={create}>
        <label htmlFor="new-title">New quiz title</label>
        <input id="new-title" name="title" maxLength={200} required />
        <button type="submit" className="secondary">
          Create quiz
        </button>
      </form>
      {(message || error) && (
        <p className="error" role="alert">
          {message || error}
        </p>
      )}
      {data === null && !error && <Skeleton />}
      {data?.length === 0 && <p className="muted empty">No quizzes yet. Give your first one a name above.</p>}
      <ul className="list quiz-grid">
        {data?.map((quiz) => (
          <li key={quiz.id} className="card">
            {renaming === quiz.id ? (
              <form className="inline" onSubmit={(e) => rename(e, quiz.id)}>
                <label htmlFor={`rename-${quiz.id}`}>New title</label>
                <input id={`rename-${quiz.id}`} name="title" defaultValue={quiz.title} maxLength={200} required autoFocus />
                <button type="submit">Save</button>
                <button type="button" className="plain" onClick={() => setRenaming(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <div className="row">
                <h2 className="grow card-title">
                  <a href={`#/quizzes/${quiz.id}`}>{quiz.title}</a>
                </h2>
                <Ready ready={quiz.ready} />
              </div>
            )}
            <Counts quiz={quiz} />
            {!quiz.ready && (
              <p id={`why-${quiz.id}`} className="small muted reason">
                Approve 1 to 10 questions to make it playable.
              </p>
            )}
            <div className="actions">
              <button type="button" onClick={() => host(quiz)} disabled={!quiz.ready} aria-describedby={quiz.ready ? undefined : `why-${quiz.id}`}>
                Host a game
              </button>
              <a className="button secondary" href={`#/quizzes/${quiz.id}`}>
                Edit questions
              </a>
              <button type="button" className="plain" onClick={() => setRenaming(quiz.id)}>
                Rename
              </button>
              <button
                type="button"
                className="danger"
                onClick={() =>
                  confirm(`Delete "${quiz.title}" and all its questions? This cannot be undone.`) &&
                  run(() => api('DELETE', `/api/quizzes/${quiz.id}`))
                }
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function Editor({ quizId }: { quizId: string }) {
  const { data: quiz, error, reload } = useLoad<Quiz>(`/api/quizzes/${quizId}`)
  const [adding, setAdding] = useState(false)

  if (!quiz) {
    return error ? (
      <p className="error" role="alert">
        {error} <a href="#/quizzes">Back to quizzes</a>
      </p>
    ) : (
      <Skeleton />
    )
  }

  return (
    <section>
      <p className="back">
        <a href="#/quizzes">
          <span className="chevron" aria-hidden="true" />
          Quizzes
        </a>
      </p>
      <div className="row title-row">
        <h1 className="grow">{quiz.title}</h1>
        <Ready ready={quiz.ready} />
      </div>
      <p className="lead">
        <Counts quiz={quiz} />. Only approved questions are used in games (1 to 10).
      </p>

      <Generate quizId={quizId} notes={quiz.notes ?? ''} onDone={reload} />

      <h2 className="section-title">Questions</h2>
      {quiz.questions.length === 0 && <p className="muted empty">No questions yet. Add one by hand or generate drafts from your notes.</p>}
      <ol className="list">
        {quiz.questions.map((q) => (
          <QuestionCard key={q.id} quizId={quizId} question={q} onChange={reload} />
        ))}
      </ol>
      {adding ? (
        <div className="card">
          <h3>New question</h3>
          <QuestionForm
            quizId={quizId}
            onDone={() => {
              setAdding(false)
              reload()
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : (
        <button type="button" className="big secondary" onClick={() => setAdding(true)}>
          Add a question
        </button>
      )}
    </section>
  )
}

function QuestionCard({ quizId, question: q, onChange }: { quizId: string; question: Question; onChange: () => void }) {
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState('')
  const base = `/api/quizzes/${quizId}/questions/${q.id}`

  async function run(action: () => Promise<unknown>) {
    setMessage('')
    try {
      await action()
      onChange()
    } catch (e) {
      setMessage(e instanceof ApiError && e.status === 422 ? `${e.message} Discard or edit another question first.` : errorText(e))
    }
  }

  return (
    <li className="card">
      <div className="row">
        <Capsule tone={q.status === 'APPROVED' ? 'ready' : 'plain'}>{q.status === 'APPROVED' ? 'Approved' : 'Draft'}</Capsule>
      </div>
      {editing ? (
        <QuestionForm
          quizId={quizId}
          question={q}
          onDone={() => {
            setEditing(false)
            onChange()
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <p className="question-text">{q.text}</p>
          <ul className="options">
            {q.options.map((option, i) => (
              <li key={i} className={i === q.correctIndex ? `a${i} correct` : `a${i}`}>
                <span className="letter">{LETTERS[i]}</span>
                <span className="shape-badge" aria-hidden="true">
                  {SHAPES[i]}
                </span>
                <span className="answer-text">{option}</span>
                {i === q.correctIndex && (
                  <strong className="correct-mark">
                    <span aria-hidden="true">✓ </span>Correct
                  </strong>
                )}
              </li>
            ))}
          </ul>
          {q.explanation && (
            <p>
              <strong>Explanation:</strong> {q.explanation}
            </p>
          )}
          {q.sourceExcerpt && (
            <figure className="excerpt">
              <figcaption className="small muted">From your notes</figcaption>
              <blockquote>{q.sourceExcerpt}</blockquote>
            </figure>
          )}
          {message && (
            <p className="error" role="alert">
              {message}
            </p>
          )}
          <div className="actions">
            {q.status === 'DRAFT' && (
              <button type="button" onClick={() => run(() => api('POST', `${base}/approve`))}>
                Approve
              </button>
            )}
            <button type="button" className="secondary" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => confirm('Discard this question? This cannot be undone.') && run(() => api('DELETE', base))}
            >
              Discard
            </button>
          </div>
        </>
      )}
    </li>
  )
}

function QuestionForm({
  quizId,
  question,
  onDone,
  onCancel,
}: {
  quizId: string
  question?: Question
  onDone: () => void
  onCancel: () => void
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const id = question?.id ?? 'new'

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const options = LETTERS.map((_, i) => String(form.get(`option${i}`)).trim())
    if (new Set(options.map((o) => o.toLowerCase())).size !== 4) {
      setError('The four options must be different.')
      return
    }
    const body = {
      text: String(form.get('text')).trim(),
      options,
      correctIndex: Number(form.get('correct')),
      explanation: String(form.get('explanation')).trim() || null,
    }
    setBusy(true)
    setError('')
    try {
      if (question) await api('PUT', `/api/quizzes/${quizId}/questions/${question.id}`, body)
      else await api('POST', `/api/quizzes/${quizId}/questions`, body)
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      {question?.status === 'APPROVED' && (
        <p className="notice">Saving changes moves this question back to Draft. You will need to approve it again.</p>
      )}
      <label htmlFor={`text-${id}`}>Question</label>
      <textarea id={`text-${id}`} name="text" rows={2} maxLength={1000} required defaultValue={question?.text} />
      <fieldset>
        <legend>Options (select the correct one)</legend>
        {LETTERS.map((letter, i) => (
          <div className={`option-row a${i}`} key={letter}>
            <input
              type="radio"
              id={`correct-${id}-${i}`}
              name="correct"
              value={i}
              required
              defaultChecked={question?.correctIndex === i}
              aria-label={`Option ${letter} is correct`}
            />
            <label htmlFor={`option-${id}-${i}`} className="letter">
              {letter}
            </label>
            <input id={`option-${id}-${i}`} name={`option${i}`} maxLength={255} required defaultValue={question?.options[i]} />
          </div>
        ))}
      </fieldset>
      <label htmlFor={`explanation-${id}`}>Explanation (optional)</label>
      <textarea
        id={`explanation-${id}`}
        name="explanation"
        rows={2}
        maxLength={2000}
        defaultValue={question?.explanation ?? ''}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" disabled={busy}>
          {question ? 'Save changes' : 'Add question'}
        </button>
        <button type="button" className="plain" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

const GENERATE_ERRORS: Record<number, string> = {
  503: 'AI generation is unavailable right now. Nothing was saved. Try again later or add questions by hand.',
  504: 'AI generation took too long and was stopped. Nothing was saved. Try again with fewer questions or shorter notes.',
}

function Generate({ quizId, notes, onDone }: { quizId: string; notes: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ created: Question[]; rejected: string[] } | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError('')
    setResult(null)
    try {
      setResult(
        await api('POST', `/api/quizzes/${quizId}/generate`, {
          notes: String(form.get('notes')),
          count: Number(form.get('count')),
        }),
      )
      onDone()
    } catch (err) {
      setError((err instanceof ApiError && GENERATE_ERRORS[err.status]) || errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card ai">
      <h2>Generate drafts from notes</h2>
      <form onSubmit={submit} aria-busy={busy}>
        <label htmlFor="notes">Study notes</label>
        <textarea id="notes" name="notes" rows={8} maxLength={20000} required defaultValue={notes} />
        <label htmlFor="count">Number of questions (1 to 10)</label>
        <input id="count" name="count" type="number" min={1} max={10} defaultValue={5} required inputMode="numeric" />
        <button type="submit" className="secondary" disabled={busy}>
          <BusyLabel busy={busy} idle="Generate drafts" active="Generating…" />
        </button>
      </form>
      <div role="status" aria-live="polite">
        {busy && (
          <p className="progress">
            <progress aria-label="Generating questions" /> Generating questions. This can take up to 2 minutes, please keep this page open.
          </p>
        )}
        {result && (
          <p className="success">
            {result.created.length} draft question{result.created.length === 1 ? '' : 's'} added below. Review and approve them before using them in a game.
          </p>
        )}
      </div>
      {busy && (
        <div className="skeleton card" aria-hidden="true">
          <div className="bone" />
          <div className="bone" />
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && result.rejected.length > 0 && (
        <div>
          <h3>Rejected suggestions</h3>
          <ul>
            {result.rejected.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

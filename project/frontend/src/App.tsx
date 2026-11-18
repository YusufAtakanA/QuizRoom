import { useEffect, useLayoutEffect, useReducer, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { ApiError, api, errorText, getToken, go, load, save } from './api'
import { Library, Editor, type HostRoom } from './Library'
import { HostGame, GameList, GameResults } from './Host'
import { Join, Play } from './Play'
import { BusyLabel } from './live'

function useHash() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const update = () => {
      const apply = () => flushSync(() => setHash(location.hash))
      if ('startViewTransition' in document) document.startViewTransition(apply).ready.catch(() => {})
      else apply()
    }
    addEventListener('hashchange', update)
    return () => removeEventListener('hashchange', update)
  }, [])
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
}

const TITLES: Record<string, string> = {
  login: 'Host login',
  register: 'Create account',
  quizzes: 'Quizzes',
  host: 'Host game',
  results: 'Past results',
  play: 'Play',
}

function logout() {
  save('qr.token', null)
  save('qr.hostRoom', null)
  go('/login')
}

function Places({ page }: { page: string }) {
  const track = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)

  useLayoutEffect(() => {
    const el = track.current
    const t = thumb.current
    if (!el || !t) return
    const place = () => {
      const current = el.querySelector<HTMLElement>('a[aria-current="page"]')
      t.hidden = !current
      if (!current) return
      if (!placed.current) t.style.transition = 'none'
      t.style.width = `${current.offsetWidth}px`
      t.style.translate = `${current.offsetLeft}px`
      if (!placed.current) {
        void t.offsetWidth
        t.style.transition = ''
        placed.current = true
      }
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(el)
    return () => observer.disconnect()
  }, [page])

  return (
    <div className="seg" ref={track}>
      <span className="seg-thumb" ref={thumb} aria-hidden="true" hidden />
      <a href="#/quizzes" aria-current={page === 'quizzes' ? 'page' : undefined}>
        <span>Quizzes</span>
      </a>
      <a href="#/results" aria-current={page === 'results' ? 'page' : undefined}>
        <span>Results</span>
      </a>
    </div>
  )
}

const nativePopover = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype

function Account({ room, onLogout }: { room: HostRoom | null; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  return (
    <>
      <button
        type="button"
        className="account"
        aria-label="Account"
        popoverTarget={nativePopover ? 'account' : undefined}
        aria-expanded={nativePopover ? undefined : open}
        onClick={nativePopover ? undefined : () => setOpen(!open)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="7" r="3.5" />
          <path d="M3.5 17c.8-3.3 3.4-5 6.5-5s5.7 1.7 6.5 5" />
        </svg>
        <span className="chev" aria-hidden="true" />
      </button>
      <div
        id="account"
        ref={menu}
        popover={nativePopover ? 'auto' : undefined}
        className={open ? 'menu open' : 'menu'}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        <p className="menu-label">Signed in as host</p>
        {room && (
          <p className="menu-note">
            You're hosting {room.quizTitle} in room {room.roomCode}. Logging out removes your host controls from this browser. Players stay in the room.
          </p>
        )}
        <hr />
        <button
          type="button"
          className="menu-row"
          onClick={() => {
            if (nativePopover) menu.current?.hidePopover()
            setOpen(false)
            onLogout()
          }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M8 3.5H4.5v13H8M12.5 6.5 16 10l-3.5 3.5M16 10H7.5" />
          </svg>
          Log out
        </button>
      </div>
    </>
  )
}

export function App() {
  const [page, id] = useHash()
  const [, refresh] = useReducer((n: number) => n + 1, 0)
  const [scrolled, setScrolled] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)
  const host = getToken() !== null
  const room = host ? load<HostRoom>('qr.hostRoom') : null
  const needsLogin = ['quizzes', 'host', 'results'].includes(page ?? '') && !host

  useEffect(() => {
    document.title = `${TITLES[page ?? ''] ?? 'Join a game'} | QuizRoom`
    if (page !== 'join' || !id) document.querySelector('main')?.focus()
  }, [page, id])

  useEffect(() => {
    addEventListener('qr:save', refresh)
    return () => removeEventListener('qr:save', refresh)
  }, [])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  let content
  if (needsLogin || page === 'login') content = <Auth mode="login" onDone={refresh} />
  else if (page === 'register') content = <Auth mode="register" onDone={refresh} />
  else if (page === 'quizzes') content = id ? <Editor key={id} quizId={id} /> : <Library />
  else if (page === 'host') content = <HostGame />
  else if (page === 'results') content = id ? <GameResults key={id} gameId={id} /> : <GameList />
  else if (page === 'play') content = <Play />
  else content = <Join key={id} code={page === 'join' ? id : undefined} />

  const shownPage = needsLogin ? 'login' : (page ?? '')

  return (
    <>
      <div ref={sentinel} className="sentinel" aria-hidden="true" />
      <header className={scrolled ? 'top scrolled' : 'top'}>
        <a href={host ? '#/quizzes' : '#/'} className="brand">
          <span className="brand-mark" aria-hidden="true">
            Q
          </span>
          QuizRoom
        </a>
        {page !== 'play' && (
          <>
            <nav aria-label="Main" className={host ? 'host-nav' : undefined}>
              {host ? (
                <>
                  <Places page={shownPage} />
                  {room && (
                    <a className="live" href="#/host" aria-current={page === 'host' ? 'page' : undefined}>
                      <span className="live-dot" aria-hidden="true" />
                      <span className="live-word">Live · </span>
                      <span className="mono">{room.roomCode}</span>
                    </a>
                  )}
                </>
              ) : (
                <a className="button secondary pill" href="#/login" aria-current={shownPage === 'login' ? 'page' : undefined}>
                  Host login
                </a>
              )}
            </nav>
            {host && (
              <Account
                room={room}
                onLogout={() => {
                  logout()
                  refresh()
                }}
              />
            )}
          </>
        )}
      </header>
      <main tabIndex={-1} className={page === 'host' && host ? 'wide' : undefined}>
        {content}
      </main>
    </>
  )
}

function Auth({ mode, onDone }: { mode: 'login' | 'register'; onDone: () => void }) {
  const [error, setError] = useState('')
  const [wrong, setWrong] = useState(false)
  const [busy, setBusy] = useState(false)
  const register = mode === 'register'

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email')).trim()
    const password = String(form.get('password'))
    setBusy(true)
    setError('')
    try {
      if (register) {
        await api('POST', '/api/auth/register', { email, password, displayName: String(form.get('displayName')).trim() }, false)
      }
      const { accessToken } = await api<{ accessToken: string }>('POST', '/api/auth/login', { email, password }, false)
      save('qr.token', accessToken)
      if (/^#\/(login|register)?$/.test(location.hash) || !location.hash) go('/quizzes')
      onDone()
    } catch (err) {
      setError(errorText(err))
      setWrong(err instanceof ApiError && err.status === 401)
      setBusy(false)
    }
  }

  return (
    <section className="narrow">
      <h1 id="auth-title">{register ? 'Create a host account' : 'Host login'}</h1>
      <p className="lead">{register ? 'Build quizzes and run live games.' : 'Log in to build quizzes and host live games.'}</p>
      <form className="card" onSubmit={submit} aria-labelledby="auth-title" aria-busy={busy}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required />
        {register && (
          <>
            <label htmlFor="displayName">Display name</label>
            <input id="displayName" name="displayName" autoComplete="nickname" maxLength={50} required />
          </>
        )}
        <label htmlFor="password">Password</label>
        {register && (
          <p id="password-hint" className="hint">
            At least 8 characters.
          </p>
        )}
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={register ? 'new-password' : 'current-password'}
          minLength={register ? 8 : undefined}
          maxLength={100}
          required
          aria-describedby={register ? 'password-hint' : undefined}
        />
        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
            {!register && wrong && <p>Your email is still filled in. Check both fields and try again. New here? Create an account below.</p>}
          </div>
        )}
        <button type="submit" className="big" disabled={busy}>
          <BusyLabel busy={busy} idle={register ? 'Create account' : 'Log in'} active={register ? 'Creating account…' : 'Logging in…'} />
        </button>
      </form>
      <p className="center foot">
        {register ? (
          <>
            Already have an account? <a href="#/login">Log in</a>
          </>
        ) : (
          <>
            New here? <a href="#/register">Create an account</a>
          </>
        )}
      </p>
      <p className="center foot">
        Playing a game? <a href="#/">Join with a room code</a>
      </p>
    </section>
  )
}

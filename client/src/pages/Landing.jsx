import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'

const NAME_STORAGE_KEY = 'collab:userName'
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:5000'
const GITHUB_URL = 'https://github.com/purohitharshita/CollaborativeCoding'

function passwordSessionKey(roomId) {
  return `collab:roomPassword:${roomId}`
}

// ===================================================================
// Feature cards — each carries a small visual vignette instead of an
// abstract icon. Animations live in index.css and are CSS-only so
// they cost nothing at runtime.
// ===================================================================
function FeatureCard({ visual, title, description }) {
  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition overflow-hidden flex flex-col">
      <div className="bg-zinc-950 border-b border-zinc-800 px-4 py-5 h-32 flex items-center justify-center">
        {visual}
      </div>
      <div className="p-5">
        <h3 className="font-semibold text-zinc-50 mb-1.5">{title}</h3>
        <p className="text-sm text-zinc-400 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}

// Card 1: a peer typing — fake code line + advancing blue caret + tag.
function CursorsVisual() {
  return (
    <div className="w-full font-mono text-sm">
      <div className="flex items-center mb-2">
        <span className="text-zinc-600 select-none w-5">1</span>
        <span className="text-pink-400">def</span>
        <span>&nbsp;</span>
        <span className="text-blue-400">hello</span>
        <span className="text-zinc-400">()</span>
        <span className="text-zinc-400">:</span>
        {/* Caret rides along — blue line + tiny flag */}
        <span className="relative ml-1 inline-block">
          <span className="feature-caret inline-block w-0.5 h-4 bg-blue-400" />
          <span className="feature-caret absolute left-0 -top-1.5 w-2 h-1 bg-blue-400" />
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <span className="w-2 h-2 rounded-full bg-blue-400" />
        <span className="text-zinc-400">Harshita is typing…</span>
      </div>
    </div>
  )
}

// Card 2: language pills with a moving highlight pill behind them.
function LanguagesVisual() {
  const langs = ['JS', 'Py', 'C++', 'Java', 'Go', 'Rs']
  return (
    <div className="relative w-full max-w-[280px]">
      {/* Moving highlight — sits behind the pills, slides to the next slot every ~1.3s */}
      <span
        className="feature-pill-highlight absolute top-0 h-7 rounded-md bg-blue-500/20 border border-blue-500/40"
        style={{ width: 'calc(16.66% - 4px)' }}
      />
      <div className="relative grid grid-cols-6 gap-1">
        {langs.map((lang) => (
          <span
            key={lang}
            className="h-7 flex items-center justify-center text-xs font-medium text-zinc-300 rounded-md"
          >
            {lang}
          </span>
        ))}
      </div>
    </div>
  )
}

// Card 3: faux terminal output — command + result + run-by tag fading in.
function ExecutionVisual() {
  return (
    <div className="w-full font-mono text-xs">
      <div className="text-zinc-500">
        <span className="text-blue-400">$</span> python main.py
      </div>
      <div className="text-zinc-100 mt-0.5">55</div>
      <div className="feature-fade-in mt-1.5 text-xs flex items-center gap-1.5 text-zinc-500">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
        <span>Run by Harshita · 142ms · exit 0</span>
      </div>
    </div>
  )
}

// ===================================================================
// Editor mockup — pure static JSX, no Monaco. Cheaper than a real
// editor and gives us pixel control over the "look at this product"
// hero shot. Code is hand-rolled with span colors that mimic VS Code's
// dark+ theme; numbers are blue-tinged to feel on-brand.
// ===================================================================
function EditorMockup() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-blue-500/5 overflow-hidden">
      {/* Window chrome */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-900">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-zinc-700" />
          <div className="w-3 h-3 rounded-full bg-zinc-700" />
          <div className="w-3 h-3 rounded-full bg-zinc-700" />
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-zinc-400">Python</span>
          <span className="px-2 py-0.5 rounded bg-blue-500 text-white font-medium">Run</span>
          <span className="flex items-center gap-1.5 text-blue-400">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Live
          </span>
        </div>
      </div>

      {/* Presence chips */}
      <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900/50 flex items-center gap-2 text-xs">
        <span className="text-zinc-500">In this room:</span>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-200">
          <span className="w-2 h-2 rounded-full bg-blue-400" />
          Harshita
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-200">
          <span className="w-2 h-2 rounded-full bg-cyan-400" />
          Pranshu
        </span>
      </div>

      {/* Fake editor body */}
      <div className="px-4 py-4 font-mono text-sm leading-relaxed">
        <div className="flex">
          <span className="text-zinc-600 select-none w-6">1</span>
          <span><span className="text-pink-400">def</span> <span className="text-blue-400">fibonacci</span><span className="text-zinc-400">(</span><span className="text-amber-200">n</span><span className="text-zinc-400">):</span></span>
        </div>
        <div className="flex">
          <span className="text-zinc-600 select-none w-6">2</span>
          <span className="pl-4"><span className="text-pink-400">if</span> <span className="text-amber-200">n</span> <span className="text-zinc-400">&lt;</span> <span className="text-blue-300">2</span><span className="text-zinc-400">:</span></span>
        </div>
        <div className="flex">
          <span className="text-zinc-600 select-none w-6">3</span>
          <span className="pl-8"><span className="text-pink-400">return</span> <span className="text-amber-200">n</span></span>
        </div>
        <div className="flex">
          <span className="text-zinc-600 select-none w-6">4</span>
          <span className="pl-4"><span className="text-pink-400">return</span> <span className="text-blue-400">fibonacci</span><span className="text-zinc-400">(</span><span className="text-amber-200">n</span><span className="text-zinc-400">-</span><span className="text-blue-300">1</span><span className="text-zinc-400">) +</span> <span className="text-blue-400">fibonacci</span><span className="text-zinc-400">(</span><span className="text-amber-200">n</span><span className="text-zinc-400">-</span><span className="text-blue-300">2</span><span className="text-zinc-400">)</span></span>
        </div>
        <div className="flex">
          <span className="text-zinc-600 select-none w-6">5</span>
          <span>&nbsp;</span>
        </div>
        <div className="flex">
          <span className="text-zinc-600 select-none w-6">6</span>
          <span>
            <span className="text-cyan-300">print</span>
            <span className="text-zinc-400">(</span>
            <span className="text-cyan-300">fibonacci</span>
            <span className="text-zinc-400">(</span>
            <span className="text-blue-300">10</span>
            <span className="text-zinc-400">))</span>
            {/* Harshita's cursor — blue, position-relative so the flag stacks above */}
            <span className="relative inline-block">
              <span className="absolute -left-px top-1 inline-block w-0.5 h-5 bg-blue-400 animate-pulse" />
              <span className="absolute -left-1 -top-3 inline-block w-2 h-1 bg-blue-400" />
            </span>
          </span>
        </div>
      </div>

      {/* Output panel */}
      <div className="border-t border-zinc-800 bg-zinc-900/50">
        <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between text-xs">
          <div className="flex gap-1">
            <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-100 font-medium">Output</span>
            <span className="px-2 py-0.5 rounded text-zinc-500">Stdin</span>
          </div>
          <span className="text-zinc-500">
            Run by <span className="text-zinc-300">Harshita</span> · 142ms · exit 0
          </span>
        </div>
        <pre className="px-4 py-3 font-mono text-sm text-zinc-100">55</pre>
      </div>
    </div>
  )
}

// ===================================================================
// Modal — premium variant. Distinct header glyph per mode, gradient
// strip, helper microcopy under fields, ESC-to-close, animated entry.
// ===================================================================

// Mode-specific config kept out of JSX so the body stays readable.
const MODE_CONFIG = {
  create: {
    title: 'Start a fresh room',
    subtitle: "We'll generate a private URL. Share it to invite anyone.",
    glyph: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v18M3 12h18" />
      </svg>
    ),
    submitLabel: 'Create room',
    submitBusyLabel: 'Creating…',
  },
  join: {
    title: 'Hop into an existing room',
    subtitle: 'Paste the room ID a friend shared with you.',
    glyph: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M13 5l7 7-7 7" />
      </svg>
    ),
    submitLabel: 'Join room',
    submitBusyLabel: null,
  },
}

function Modal({ mode, onClose, name, navigate }) {
  const config = MODE_CONFIG[mode]
  const [password, setPassword] = useState('')
  const [joinId, setJoinId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // ESC to close. Added once on mount; React strict mode safely re-runs.
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const handleCreate = async () => {
    if (busy) return
    setError(null)
    setBusy(true)
    const newId = crypto.randomUUID().slice(0, 8)
    try {
      const res = await fetch(`${SERVER_URL}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: newId,
          ...(password.length > 0 ? { password } : {}),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `request failed (${res.status})`)
      }
      if (password.length > 0) {
        sessionStorage.setItem(passwordSessionKey(newId), password)
      }
      navigate(`/room/${newId}`)
    } catch (err) {
      setError(err.message || 'Failed to create room')
      setBusy(false)
    }
  }

  const handleJoin = (e) => {
    e.preventDefault()
    const trimmed = joinId.trim()
    if (!trimmed) return

    // Accept either a raw room id ("abc12345") or a full URL ending in /room/<id>.
    const urlMatch = trimmed.match(/\/room\/([a-zA-Z0-9_-]{1,40})\/?$/)
    const id = urlMatch ? urlMatch[1] : trimmed.replace(/\/$/, '')

    // Validate against the same pattern the server enforces. Catches malformed
    // pastes early instead of sending the user to a confusing "not-found" page.
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id)) {
      setError("That doesn't look like a valid room ID. Try just the ID, e.g. abc12345.")
      return
    }

    setError(null)
    navigate(`/room/${id}`)
  }

  return (
    <div
      className="modal-backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/85 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="modal-panel-enter w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl shadow-blue-500/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ===== Gradient header strip ===== */}
        <div className="relative px-7 pt-7 pb-6 bg-gradient-to-br from-blue-500/10 via-zinc-900 to-zinc-900 border-b border-zinc-800">
          {/* Close button — absolute so the header content doesn't have to leave room */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition flex items-center justify-center"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          {/* Glyph in a glowing circle */}
          <div className="w-11 h-11 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 mb-4 shadow-lg shadow-blue-500/10">
            {config.glyph}
          </div>

          <h2 id="modal-title" className="text-xl font-semibold text-zinc-50 mb-1.5 tracking-tight">
            {config.title}
          </h2>
          <p className="text-sm text-zinc-400">{config.subtitle}</p>
        </div>

        {/* ===== Body ===== */}
        <div className="px-7 py-6">
          {/* Anonymous-mode badge */}
          <div className="flex items-center gap-2 mb-6 px-3 py-2 rounded-lg bg-zinc-950/80 border border-zinc-800">
            <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
            <span className="text-sm text-zinc-400">
              Joining as <span className="font-medium text-zinc-100">{name}</span>
            </span>
          </div>

          {mode === 'create' ? (
            <>
              <label className="block text-sm font-medium text-zinc-300 mb-2" htmlFor="password">
                Room password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank for a public room"
                autoFocus
                autoComplete="new-password"
                className="w-full px-4 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition"
              />
              <p className="text-xs text-zinc-500 mt-2 mb-6">
                Optional. If you set one, peers will need it to join.
              </p>

              <button
                onClick={handleCreate}
                disabled={busy}
                className="w-full px-4 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-zinc-950 shadow-lg shadow-blue-500/20"
              >
                {busy ? config.submitBusyLabel : config.submitLabel}
              </button>
            </>
          ) : (
            <form onSubmit={handleJoin}>
              <label className="block text-sm font-medium text-zinc-300 mb-2" htmlFor="join-id">
                Room ID or URL
              </label>
              <input
                id="join-id"
                type="text"
                value={joinId}
                onChange={(e) => setJoinId(e.target.value)}
                placeholder="e.g. abc12345"
                autoFocus
                className="w-full px-4 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition"
              />
              <p className="text-xs text-zinc-500 mt-2 mb-6">
                Accept either the short ID or a full URL like{' '}
                <span className="font-mono text-zinc-400">/room/abc12345</span>.
              </p>

              <button
                type="submit"
                disabled={!joinId.trim()}
                className="w-full px-4 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-zinc-950 shadow-lg shadow-blue-500/20"
              >
                {config.submitLabel}
              </button>
            </form>
          )}

          {error && (
            <p className="mt-4 text-sm text-rose-400 text-center" role="alert">
              {error}
            </p>
          )}

          {/* Footer hint — micro-copy reinforces the "no accounts" promise */}
          <p className="mt-5 text-xs text-zinc-600 text-center">
            No accounts, no tracking. Your name is stored locally.
          </p>
        </div>
      </div>
    </div>
  )
}

// ===================================================================
// Landing page
// ===================================================================
function Landing() {
  const navigate = useNavigate()
  const [name, setName] = useState(
    () => localStorage.getItem(NAME_STORAGE_KEY) || ''
  )
  const [modal, setModal] = useState(null) // null | 'create' | 'join'

  useEffect(() => {
    localStorage.setItem(NAME_STORAGE_KEY, name)
  }, [name])

  const canProceed = name.trim().length > 0

  const openModal = (mode) => {
    if (!canProceed) {
      // Scroll to name input + flash focus.
      document.getElementById('name-input')?.focus()
      return
    }
    setModal(mode)
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* ============ Nav ============ */}
      <nav className="px-6 py-4 flex items-center justify-between border-b border-zinc-900">
        <Logo size="md" />
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-zinc-400 hover:text-zinc-100 transition flex items-center gap-1.5"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 016 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.48 5.92.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.22.7.83.58A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          GitHub
        </a>
      </nav>

      {/* ============ Hero ============ */}
      <section className="flex-1 flex items-center px-6 py-16 md:py-24">
        <div className="max-w-6xl mx-auto w-full">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-zinc-50 mb-5 leading-tight">
                 Write, Collaborate, 
                <br />
                <span className="text-blue-400">Execute</span>
              </h1>
              <p className="text-lg text-zinc-400 mb-8 leading-relaxed">
                Spin up a room, share the link, and edit the same file with live cursors,
                six languages, and shared code execution. No accounts.
              </p>

              <div className="space-y-3 mb-6">
                <label className="block text-sm text-zinc-400" htmlFor="name-input">
                  Your name
                </label>
                <input
                  id="name-input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Harshita"
                  className="w-full px-4 py-3 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => openModal('create')}
                  disabled={!canProceed}
                  className="px-6 py-3 rounded-lg bg-blue-500 hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-zinc-100 shadow-lg shadow-blue-500/20"
                >
                  Create a room
                </button>
                <button
                  onClick={() => openModal('join')}
                  disabled={!canProceed}
                  className="px-6 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-zinc-100"
                >
                  Join existing
                </button>
              </div>
            </div>

            <div className="hidden md:block">
              <EditorMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ============ Features ============ */}
      <section className="px-6 py-16 border-t border-zinc-900">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-semibold text-zinc-50 mb-2 text-center">
            Pair programming without the friction.
          </h2>
          <p className="text-zinc-500 text-center mb-12">
            Three things every real-time editor should get right.
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            <FeatureCard
              visual={<CursorsVisual />}
              title="See them think."
              description="Live cursors show where collaborators are typing — colored, throttled, ephemeral. Their work appears the moment they hit a key."
            />
            <FeatureCard
              visual={<LanguagesVisual />}
              title="Six drafts, one room."
              description="Switch languages without losing work. Each language keeps its own draft, so you can prototype in Python and ship in Rust without copy-pasting."
            />
            <FeatureCard
              visual={<ExecutionVisual />}
              title="Run for everyone."
              description="Hit Run and the output broadcasts to every peer. Stdout, exit code, runtime — shared, so nobody asks 'wait, what did it print?'"
            />
          </div>
        </div>
      </section>

      {/* ============ Footer ============ */}
      <footer className="px-6 py-8 border-t border-zinc-900">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-zinc-500">
          <div>
            MIT · Built by{' '}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-300 hover:text-blue-400 transition"
            >
              @purohitharshita
            </a>
          </div>
          <div className="flex items-center gap-4">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-300 transition"
            >
              Source
            </a>
            <span className="text-zinc-700">·</span>
            <span>v0.8</span>
          </div>
        </div>
      </footer>

      {modal && (
        <Modal
          mode={modal}
          onClose={() => setModal(null)}
          name={name}
          navigate={navigate}
        />
      )}
    </div>
  )
}

export default Landing

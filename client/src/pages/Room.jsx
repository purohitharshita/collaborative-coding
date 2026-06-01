import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import Editor from '@monaco-editor/react'

import RoomNav from '../components/RoomNav'
import { ToastContainer, useToasts } from '../components/Toast'


const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:5000'
const NAME_STORAGE_KEY = 'collab:userName'
const PANEL_HEIGHT_STORAGE_KEY = 'collab:outputPanelHeight'
const PANEL_HEIGHT_DEFAULT = 288 // px — was h-72
const PANEL_HEIGHT_MIN = 120
const EDITOR_HEIGHT_MIN = 200

function passwordSessionKey(roomId) {
  return `collab:roomPassword:${roomId}`
}

const AVATAR_COLORS = [
  'bg-cyan-400',
  'bg-amber-400',
  'bg-pink-400',
  'bg-violet-400',
  'bg-orange-400',
  'bg-rose-400',
  'bg-teal-400',
  'bg-fuchsia-400',
]

const LANGUAGE_OPTIONS = [
  { id: 'javascript', label: 'JavaScript' },
  { id: 'python',     label: 'Python'     },
  { id: 'cpp',        label: 'C++'        },
  { id: 'java',       label: 'Java'       },
  { id: 'go',         label: 'Go'         },
  { id: 'rust',       label: 'Rust'       },
]


function colorIndexForSocket(socketId) {
  let hash = 0
  for (let i = 0; i < socketId.length; i++) {
    hash = (hash * 31 + socketId.charCodeAt(i)) >>> 0
  }
  return hash % AVATAR_COLORS.length
}

function colorForSocket(socketId) {
  return AVATAR_COLORS[colorIndexForSocket(socketId)]
}


// Leading + trailing throttle. First call emits immediately; subsequent calls
// within `intervalMs` coalesce into a single trailing emit. Keeps cursor
// traffic to ~20 ev/s per user even when arrow-keying through a file.
function createCursorThrottle(emit, intervalMs = 50) {
  let lastEmitAt = 0
  let pendingPosition = null
  let timer = null

  function flush() {
    timer = null
    if (pendingPosition !== null) {
      lastEmitAt = Date.now()
      emit(pendingPosition)
      pendingPosition = null
    }
  }

  return (position) => {
    const now = Date.now()
    const elapsed = now - lastEmitAt
    if (elapsed >= intervalMs) {
      lastEmitAt = now
      emit(position)
    } else {
      pendingPosition = position
      if (!timer) timer = setTimeout(flush, intervalMs - elapsed)
    }
  }
}


function Room() {
  const { roomId } = useParams()
  const socketRef = useRef(null)
  const editorRef = useRef(null)
  const applyingRemote = useRef(false)
  const mainRef = useRef(null)
  // socketId -> { lineNumber, column }. Imperative state — we don't want
  // React re-rendering on every remote keystroke; Monaco's decoration API
  // handles the DOM directly.
  const remoteCursorsRef = useRef(new Map())
  // Monaco's decorations collection. Created once on editor mount, then
  // .set([...]) replaces the visible set atomically on each update.
  const decorationsRef = useRef(null)
  // The monaco namespace itself — captured from onMount because
  // @monaco-editor/react doesn't expose it globally.
  const monacoRef = useRef(null)
  // Password we'll submit on the next connection attempt. Held in a ref
  // so that mutating it doesn't itself trigger a re-render / reconnect.
  const passwordRef = useRef(null)
  // The socket listeners in the connection useEffect close over `language` at
  // the time the socket was created. To filter incoming code-changes by the
  // current language, we read through a ref that always points at the latest.
  const languageRef = useRef('javascript')
  // Ref to the latest handleRun. Monaco commands are registered once on
  // mount and would otherwise close over a stale handleRun.
  const handleRunRef = useRef(null)
  // Cursor position captured right before a remote code-change lands.
  // Restored in handleChange to undo the cursor drag Monaco does when its
  // controlled `value` prop is updated.
  const savedCursorPositionRef = useRef(null)
  // 'probing' | 'password-required' | 'connecting' | 'connected' | 'not-found' | 'error'
  const [status, setStatus] = useState('probing')
  const [errorMessage, setErrorMessage] = useState(null)
  // Incrementing this is the explicit signal to (re)connect the socket.
  const [connectKey, setConnectKey] = useState(0)
  const [passwordInput, setPasswordInput] = useState('')

  const [connected, setConnected] = useState(false)
  const [socketId, setSocketId] = useState(null)
  const [users, setUsers] = useState([])
  const [language, setLanguage] = useState('javascript')
  const [code, setCode] = useState(
    '// Loading…\n'
  )

  const { toasts, showToast } = useToasts()
  const [panelHeight, setPanelHeight] = useState(() => {
    const stored = Number(localStorage.getItem(PANEL_HEIGHT_STORAGE_KEY))
    return Number.isFinite(stored) && stored >= PANEL_HEIGHT_MIN ? stored : PANEL_HEIGHT_DEFAULT
  })
  const [executing, setExecuting] = useState(false)
  const [stdin, setStdin] = useState('')
  const [result, setResult] = useState(null)
  const [runError, setRunError] = useState(null)
  const [activeTab, setActiveTab] = useState('output') // 'output' | 'stdin'

  useEffect(() => {
    languageRef.current = language
  }, [language])

  const renderCursors = useCallback(() => {
    const editor = editorRef.current
    const collection = decorationsRef.current
    const monaco = monacoRef.current
    if (!editor || !collection || !monaco) return

    const decorations = []

    for (const [remoteId, pos] of remoteCursorsRef.current.entries()) {
      const colorIndex = colorIndexForSocket(remoteId)
      decorations.push({
        range: new monaco.Range(
          pos.lineNumber,
          pos.column,
          pos.lineNumber,
          pos.column
        ),
        options: {
          beforeContentClassName: `remote-cursor remote-cursor-${colorIndex}`,
          stickiness:
            monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      })
    }
    collection.set(decorations)
  }, [])

  // Probe the room before connecting. Determines whether to connect
  // immediately (public / cached password) or show a password prompt first.
  useEffect(() => {
    let cancelled = false

    setStatus('probing')
    setErrorMessage(null)
    setUsers([])
    setConnected(false)
    setSocketId(null)
    setPasswordInput('')
    passwordRef.current = null

    async function probe() {
      try {
        const res = await fetch(`${SERVER_URL}/api/rooms/${roomId}`)
        if (!res.ok) throw new Error(`probe failed (${res.status})`)
        const data = await res.json()
        if (cancelled) return

        if (!data.exists) {
          setStatus('not-found')
          return
        }

        if (data.requiresPassword) {
          const cached = sessionStorage.getItem(passwordSessionKey(roomId))
          if (cached) {
            passwordRef.current = cached
            setStatus('connecting')
            setConnectKey((k) => k + 1)
          } else {
            setStatus('password-required')
          }
        } else {
          passwordRef.current = null
          setStatus('connecting')
          setConnectKey((k) => k + 1)
        }
      } catch {
        if (cancelled) return
        setErrorMessage('Failed to load room')
        setStatus('error')
      }
    }

    probe()
    return () => {
      cancelled = true
    }
  }, [roomId])

  // Actual socket connection. Runs only after connectKey > 0, and re-runs
  // whenever connectKey increments (e.g. after submitting a password).
  useEffect(() => {
    if (connectKey === 0) return

    const socket = io(SERVER_URL)
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      setSocketId(socket.id)
      const name = localStorage.getItem(NAME_STORAGE_KEY) || 'Anonymous'
      socket.emit('join-room', {
        roomId,
        name,
        ...(passwordRef.current ? { password: passwordRef.current } : {}),
      })
    })

    socket.on('init-room', ({ code: initialCode, language: initialLanguage }) => {
      setStatus('connected')
      setLanguage(initialLanguage)
      setCode((current) => {
        if (current === initialCode) return current
        applyingRemote.current = true
        return initialCode
      })
    })

    socket.on('code-change', ({ code: newCode, language: incomingLang }) => {
      // A peer who hasn't yet received our language-change may still be
      // broadcasting edits authored in the old language. Ignore those.
      if (incomingLang !== languageRef.current) return

      const editor = editorRef.current
      if (editor) {
        savedCursorPositionRef.current = editor.getPosition()
      }
      setCode((current) => {
        if (current === newCode) return current
        applyingRemote.current = true
        return newCode
      })
    })

    socket.on('language-change', ({ language: newLang, code: newCode }) => {
      // Capture cursor before the buffer swaps — same dance as code-change.
      const editor = editorRef.current
      if (editor) {
        savedCursorPositionRef.current = editor.getPosition()
      }

      setLanguage(newLang)
      setResult(null)         // ← add
      setRunError(null)       // ← add
      setCode((prev) => {
        if (prev === newCode) return prev
        applyingRemote.current = true
        return newCode
      })

      // Cursor positions captured under the old language's code don't make sense
      // in the new language's buffer. Drop them; remotes will re-emit on next move.
      remoteCursorsRef.current.clear()
      renderCursors()
    })


    socket.on('room-users', (list) => {
      setUsers(list)
      // Prune cursors for users no longer in the room.
      const presentIds = new Set(list.map((u) => u.socketId))
      let changed = false
      for (const id of remoteCursorsRef.current.keys()) {
        if (!presentIds.has(id)) {
          remoteCursorsRef.current.delete(id)
          changed = true
        }
      }
      if (changed) renderCursors()
    })


    socket.on('join-error', ({ reason }) => {
      // Server rejected our join. Tear down the socket and route the user
      // to whichever state matches the rejection reason.
      socket.disconnect()

      if (reason === 'wrong-password' || reason === 'password-required') {
        sessionStorage.removeItem(passwordSessionKey(roomId))
        passwordRef.current = null
        setPasswordInput('')
        setErrorMessage(
          reason === 'wrong-password' ? 'Incorrect password' : null
        )
        setStatus('password-required')
      } else if (reason === 'not-found') {
        setStatus('not-found')
      } else {
        setErrorMessage('Could not join room')
        setStatus('error')
      }
    })

    socket.on('cursor-move', ({ socketId: remoteId, position }) => {
      if (
        !position ||
        typeof position.lineNumber !== 'number' ||
        typeof position.column !== 'number' ||
        position.lineNumber < 1 ||
        position.column < 1
      ) {
        return
      }
      remoteCursorsRef.current.set(remoteId, position)
      renderCursors()
    })

    socket.on('execution-result', (data) => {
      setResult(data)
      setRunError(null)
      setActiveTab('output')
    })

    socket.on('disconnect', () => {
      setConnected(false)
      setSocketId(null)
      setUsers([])
      remoteCursorsRef.current.clear()
      renderCursors()
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [connectKey, roomId, renderCursors])

  const handleChange = (value) => {
    const newCode = value ?? ''
    setCode(newCode)

    if (applyingRemote.current) {
      // Undo the cursor drag Monaco does when executeEdits replaces the model.
      // We keep applyingRemote=true across setPosition so the cursor listener
      // doesn't emit the shifted-then-restored intermediate position.
      const editor = editorRef.current
      if (editor && savedCursorPositionRef.current) {
        editor.setPosition(savedCursorPositionRef.current)
        savedCursorPositionRef.current = null
      }
      applyingRemote.current = false
      return
    }

    socketRef.current?.emit('code-change', { roomId, code: newCode, language: languageRef.current })
  }

  const handleRun = async () => {
    if (executing || !connected || !socketId) return

    setExecuting(true)
    setRunError(null)

    try {
      const res = await fetch(`${SERVER_URL}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          language: languageRef.current,
          code,
          stdin,
          socketId,
        }),
      })

      if (res.status === 429) {
        const data = await res.json().catch(() => ({}))
        const wait = Math.ceil((data.waitMs ?? 1000) / 100) / 10
        setRunError(`Cooldown — try again in ${wait}s.`)
      } else if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data.error === 'daily-limit-reached') {
          setRunError("Daily execution limit reached. Try again tomorrow.")
        } else {
          setRunError(data.error || `Run failed (${res.status})`)
        }
      }else {
        const data = await res.json()
        setResult(data)
        setActiveTab('output')
      }
    } catch {
      setRunError('Network error — could not reach server.')
    } finally {
      setExecuting(false)
    }
  }

  useEffect(() => {
    handleRunRef.current = handleRun
  })

  const startResize = (e) => {
    e.preventDefault()
    const main = mainRef.current
    if (!main) return

    const startY = e.clientY
    const startHeight = panelHeight
    const mainRect = main.getBoundingClientRect()

    document.documentElement.classList.add('is-row-resizing')

    const onMove = (ev) => {
      const dy = startY - ev.clientY // up = positive = grow output
      let next = startHeight + dy

      // Clamp so editor stays at least EDITOR_HEIGHT_MIN tall.
      const maxPanel = mainRect.height - EDITOR_HEIGHT_MIN
      if (next < PANEL_HEIGHT_MIN) next = PANEL_HEIGHT_MIN
      if (next > maxPanel) next = maxPanel

      setPanelHeight(next)
    }

    const onUp = () => {
      document.documentElement.classList.remove('is-row-resizing')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)

      // Persist the final height — read from the latest state via a setter.
      setPanelHeight((current) => {
        localStorage.setItem(PANEL_HEIGHT_STORAGE_KEY, String(current))
        return current
      })
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const handlePasswordSubmit = (e) => {
    e.preventDefault()
    const pw = passwordInput
    if (!pw) return
    passwordRef.current = pw
    sessionStorage.setItem(passwordSessionKey(roomId), pw)
    setErrorMessage(null)
    setStatus('connecting')
    setConnectKey((k) => k + 1)
  }

  // ---------- Render branches ----------

  if (status === 'probing') {
    return <ProbingPage />
  }


  if (status === 'not-found') {
    return <NotFoundPage roomId={roomId} />
  }

  if (status === 'password-required') {
    return (
      <PasswordPage
        roomId={roomId}
        passwordInput={passwordInput}
        setPasswordInput={setPasswordInput}
        onSubmit={handlePasswordSubmit}
        errorMessage={errorMessage}
      />
    )
  }

  if (status === 'error') {
    return (
      <ErrorPage
        message={errorMessage}
        onRetry={() => {
          // Bump connectKey to re-trigger the probe + connect cycle.
          setStatus('probing')
          setErrorMessage(null)
          setConnectKey((k) => k + 1)
        }}
      />
    )
  }

  // status === 'connecting' or 'connected'
  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <header className="flex flex-col gap-2 px-6 py-3 border-b border-zinc-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              aria-label="Back to home"
              title="Back to home"
              className="w-8 h-8 rounded-md border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-emerald-400 hover:border-zinc-700 hover:bg-zinc-800 transition flex items-center justify-center shrink-0"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </Link>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">
                Room{' '}
                <span className="font-mono text-emerald-400">{roomId}</span>
              </h1>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(window.location.href)
                    showToast({ message: 'Room URL copied', variant: 'success' })
                  } catch {
                    // Clipboard API needs a secure context (https or localhost).
                    // Fall back to copying just the ID via a textarea trick.
                    const ta = document.createElement('textarea')
                    ta.value = window.location.href
                    ta.style.position = 'fixed'
                    ta.style.opacity = '0'
                    document.body.appendChild(ta)
                    ta.select()
                    try {
                      document.execCommand('copy')
                      showToast({ message: 'Room URL copied', variant: 'success' })
                    } catch {
                      showToast({ message: "Couldn't copy — copy from address bar", variant: 'error' })
                    }
                    document.body.removeChild(ta)
                  }
                }}
                className="p-1.5 rounded-md text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800/60 transition"
                aria-label="Copy room URL"
                title="Copy room URL"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <select
              value={language}
              onChange={(e) => {
                socketRef.current?.emit('language-change', {
                  roomId,
                  language: e.target.value,
                })
              }}
              disabled={status !== 'connected'}
              className="bg-zinc-900 text-zinc-100 text-sm rounded px-2 py-1 border border-zinc-800 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
              aria-label="Programming language"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>

            <button
              onClick={handleRun}
              disabled={executing || !connected}
              title={`Run code (${navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'}+Enter)`}
              className="px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition text-zinc-950 font-medium text-sm flex items-center gap-1.5"
            >
              {executing ? (
                'Running…'
              ) : (
                <>
                  Run
                  <kbd className="hidden md:inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-600/40 text-[10px] font-mono font-medium text-emerald-50">
                    {navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'}↵
                  </kbd>
                </>
              )}
            </button>

            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  connected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
              <span className={connected ? 'text-emerald-400' : 'text-amber-400'}>
                {connected ? 'Connected' : 'Connecting…'}
              </span>
            </div>
          </div>

        </div>

        {users.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <span className="shrink-0">In this room:</span>
            <div className="flex items-center gap-2 flex-wrap">
              {users.map((u) => {
                const isYou = u.socketId === socketId
                if (isYou) {
                  return (
                    <EditableChip
                      key={u.socketId}
                      name={u.name}
                      colorClass={colorForSocket(u.socketId)}
                      onSave={(newName) => {
                        localStorage.setItem(NAME_STORAGE_KEY, newName)
                        socketRef.current?.emit('update-name', { name: newName })
                      }}
                    />
                  )
                }
                return (
                  <span
                    key={u.socketId}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-200"
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${colorForSocket(u.socketId)}`}
                      aria-hidden="true"
                    />
                    {u.name}
                  </span>
                )
              })}
            </div>
            <span className="text-zinc-500 shrink-0">({users.length})</span>
          </div>
        )}
      </header>

      <main ref={mainRef} className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 min-h-0">
          <Editor
            height="100%"
            language={language}
            theme="coderoom-dark"
            value={code}
            onChange={handleChange}
            onMount={(editor, monaco) => {
              editorRef.current = editor
              monacoRef.current = monaco
              decorationsRef.current = editor.createDecorationsCollection([])

              // Custom Monaco theme that matches our zinc/emerald palette.
              // Defined inside onMount so we have a guaranteed monaco namespace;
              // monaco.editor.defineTheme is idempotent — re-registering on every
              // mount is fine and only costs microseconds.
              monaco.editor.defineTheme('coderoom-dark', {
                base: 'vs-dark',
                inherit: true,
                rules: [
                  // Optional: subtle syntax tweaks. Leaving most as 'inherit' keeps
                  // language-aware highlighting intact; we only override the chrome.
                ],
                colors: {
                  'editor.background':                  '#09090b', // zinc-950 — match page
                  'editor.foreground':                  '#fafafa', // zinc-50
                  'editorLineNumber.foreground':        '#3f3f46', // zinc-700, dim gutter
                  'editorLineNumber.activeForeground':  '#a1a1aa', // zinc-400, current line
                  'editor.lineHighlightBackground':     '#18181b', // zinc-900, current-line highlight
                  'editor.lineHighlightBorder':         '#00000000',
                  'editor.selectionBackground':         '#10b98140', // emerald with alpha
                  'editor.inactiveSelectionBackground': '#10b98120',
                  'editor.selectionHighlightBackground':'#10b98120',
                  'editorCursor.foreground':            '#34d399', // emerald-400 self-cursor
                  'editorWhitespace.foreground':        '#27272a', // zinc-800
                  'editorIndentGuide.background':       '#18181b',
                  'editorIndentGuide.activeBackground': '#3f3f46',
                  'editorBracketMatch.background':      '#10b98130',
                  'editorBracketMatch.border':          '#10b981',
                  'scrollbarSlider.background':         '#27272a80',
                  'scrollbarSlider.hoverBackground':    '#3f3f4680',
                  'scrollbarSlider.activeBackground':   '#52525b80',
                  'editorWidget.background':            '#18181b', // zinc-900, autocomplete bg
                  'editorWidget.border':                '#27272a',
                  'editorSuggestWidget.background':     '#18181b',
                  'editorSuggestWidget.border':         '#27272a',
                  'editorSuggestWidget.selectedBackground': '#27272a',
                  'editorSuggestWidget.highlightForeground': '#34d399',
                  'editorHoverWidget.background':       '#18181b',
                  'editorHoverWidget.border':           '#27272a',
                },
              })
              monaco.editor.setTheme('coderoom-dark')

              // Ctrl/Cmd+Enter to run. monaco.KeyMod.CtrlCmd resolves to the
              // platform-appropriate modifier (Cmd on Mac, Ctrl elsewhere).
              editor.addCommand(
                monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
                () => handleRunRef.current?.()
              )

              const emitCursor = createCursorThrottle((position) => {
                socketRef.current?.emit('cursor-move', { roomId, position })
              }, 50)

              editor.onDidChangeCursorPosition((e) => {
                if (applyingRemote.current) return
                emitCursor({
                  lineNumber: e.position.lineNumber,
                  column: e.position.column,
                })
              })

              editor.onDidChangeModelContent(() => {
                renderCursors()
              })

              renderCursors()
            }}
            options={{
              fontSize: 14,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              padding: { top: 12 },
              readOnly: status !== 'connected',
            }}
          />
        </div>

        <div
          onPointerDown={startResize}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize output panel"
          title="Drag to resize"
          className="h-1.5 bg-zinc-900 hover:bg-emerald-500/40 active:bg-emerald-500/60 cursor-row-resize transition-colors group relative"
        >
          <div className="absolute inset-x-0 -top-1 -bottom-1" />
          </div>
          <div
            style={{ height: panelHeight }}
            className="flex flex-col bg-zinc-950 shrink-0"
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-900 bg-zinc-900/40">
              <div className="flex gap-1">
                <button
                  onClick={() => setActiveTab('output')}
                  className={`px-3 py-1 rounded text-sm font-medium transition ${
                    activeTab === 'output'
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Output
                </button>
                <button
                  onClick={() => setActiveTab('stdin')}
                  className={`px-3 py-1 rounded text-sm font-medium transition ${
                    activeTab === 'stdin'
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Stdin{stdin ? ` (${stdin.length})` : ''}
                </button>
              </div>

              {result && activeTab === 'output' && (
                <div className="text-xs text-zinc-400 flex items-center gap-2">
                  <span>Run by </span>
                  <span className="text-zinc-200 font-medium">{result.runBy.name}</span>
                  <span className="text-zinc-600">·</span>
                  <span>{result.executionTimeMs}ms</span>
                  <span className="text-zinc-600">·</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${
                      result.exitCode === 0
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                    }`}
                  >
                    exit {result.exitCode}
                  </span>
                </div>
              )}
            </div>

          <div className="flex-1 overflow-auto bg-black">
            {activeTab === 'output' ? (
              runError ? (
                <div className="p-4 text-rose-400 font-mono text-sm">{runError}</div>
              ) : !result ? (
                <div className="p-4 text-zinc-600 italic text-sm font-mono">
                  <span className="text-emerald-500/70">$</span> waiting for first run…
                </div>
              ) : (
                <div className="p-3 font-mono text-sm leading-relaxed">
                  {/* Fake prompt line so the panel reads as a terminal */}
                  <div className="text-zinc-500 mb-2">
                    <span className="text-emerald-400">$</span>{' '}
                    <span className="text-zinc-400">run</span>{' '}
                    <span className="text-zinc-300">{result.language}</span>
                  </div>
                  {result.stdout && (
                    <pre className="text-zinc-100 whitespace-pre-wrap">
                      {result.stdout}
                    </pre>
                  )}
                  {result.stderr && (
                    <pre className="text-rose-400 whitespace-pre-wrap mt-2">
                      {result.stderr}
                    </pre>
                  )}
                  {!result.stdout && !result.stderr && (
                    <div className="text-zinc-600 italic">(empty output)</div>
                  )}
                </div>
              )
            ) : (
              <textarea
                value={stdin}
                onChange={(e) => setStdin(e.target.value)}
                placeholder="Input piped to your program on stdin. Local to your tab — not synced."
                className="w-full h-full p-3 bg-black text-zinc-100 font-mono text-sm focus:outline-none resize-none"
              />
            )}
          </div>
        </div>
      </main>
      <ToastContainer toasts={toasts} />
    </div>
  )
}

// ===================================================================
// Not-found page. Three recovery paths: try a different room, create
// a new room with the typed ID, or go home. Replaces the bare
// "Room not found" dead-end.
// ===================================================================
function NotFoundPage({ roomId }) {
  const navigate = useNavigate()
  const [retryId, setRetryId] = useState('')
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  const handleTryAgain = (e) => {
    e.preventDefault()
    const trimmed = retryId.trim()
    if (!trimmed) return

    // Same dual-format parsing as Landing's join modal.
    const urlMatch = trimmed.match(/\/room\/([a-zA-Z0-9_-]{1,40})\/?$/)
    const id = urlMatch ? urlMatch[1] : trimmed.replace(/\/$/, '')

    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id)) {
      setError("That doesn't look like a valid room ID.")
      return
    }
    setError(null)
    navigate(`/room/${id}`)
  }

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(roomId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API can fail on insecure origins; degrade silently.
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <RoomNav />

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          {/* Glyph */}
          <div className="w-14 h-14 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-6 mx-auto">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3" />
            </svg>
          </div>

          <h1 className="text-2xl font-semibold text-zinc-50 text-center tracking-tight mb-2">
            That room doesn't exist
          </h1>
          <p className="text-sm text-zinc-400 text-center mb-6">
            We couldn't find a room with this ID. Maybe a typo, maybe it expired.
          </p>

          {/* The bad ID, in a mono chip with copy */}
          <div className="flex items-center gap-2 mb-7 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800">
            <span className="text-xs text-zinc-500 shrink-0">ID:</span>
            <span className="font-mono text-sm text-zinc-200 truncate">{roomId}</span>
            <button
              onClick={handleCopyId}
              className="ml-auto text-xs text-zinc-500 hover:text-emerald-400 transition shrink-0"
              aria-label="Copy room ID"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          {/* Try a different room — primary */}
          <form onSubmit={handleTryAgain} className="mb-5">
            <label className="block text-sm font-medium text-zinc-300 mb-2" htmlFor="retry-id">
              Try a different room
            </label>
            <div className="flex gap-2">
              <input
                id="retry-id"
                type="text"
                value={retryId}
                onChange={(e) => setRetryId(e.target.value)}
                placeholder="Room ID or URL"
                className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition text-sm"
              />
              <button
                type="submit"
                disabled={!retryId.trim()}
                className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-zinc-950 text-sm"
              >
                Join
              </button>
            </div>
          </form>

          {/* Home — tertiary */}
          <Link
            to="/"
            className="block text-center text-sm text-zinc-500 hover:text-zinc-300 transition"
          >
            ← Back to home
          </Link>

          {error && (
            <p className="mt-4 text-sm text-rose-400 text-center" role="alert">
              {error}
            </p>
          )}
        </div>
      </main>
    </div>
  )
}

// ===================================================================
// Generic error page. Used when the probe itself fails (network, 500,
// etc.) — not for not-found, which has its own targeted recovery.
// ===================================================================
function ErrorPage({ message, onRetry }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <RoomNav />

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md text-center">
          <div className="w-14 h-14 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-6 mx-auto">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>

          <h1 className="text-2xl font-semibold text-zinc-50 tracking-tight mb-2">
            Something went wrong
          </h1>
          <p className="text-sm text-zinc-400 mb-5">
            We couldn't load this room. The diagnostic might help:
          </p>

          <div className="mb-7 px-4 py-3 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-sm text-zinc-300 text-left break-words">
            {message || 'Unknown error'}
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={onRetry}
              className="w-full px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 transition font-medium text-zinc-950 text-sm"
            >
              Try again
            </button>
            <Link
              to="/"
              className="text-sm text-zinc-500 hover:text-zinc-300 transition pt-1"
            >
              ← Back to home
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}

// ===================================================================
// Probing page. Shown while we're fetching /api/rooms/:id to learn
// whether the room exists and needs a password. Brief in the happy
// path; can stretch on free-tier cold start (Render wakes ~30s).
// ===================================================================
function ProbingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <RoomNav />

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="flex flex-col items-center gap-4">
          {/* Spinner — emerald ring with a transparent gap rotating */}
          <div
            className="w-10 h-10 rounded-full border-2 border-zinc-800 border-t-emerald-400 animate-spin"
            aria-hidden="true"
          />
          <p className="text-sm text-zinc-500">Loading room…</p>
        </div>
      </main>
    </div>
  )
}

// ===================================================================
// Password-required page. Shown when the room exists but is private
// and the client has no cached password for it. Submitting bumps
// connectKey to trigger the real connection attempt.
// ===================================================================
function PasswordPage({ roomId, passwordInput, setPasswordInput, onSubmit, errorMessage }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <RoomNav />

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          {/* Glyph — padlock */}
          <div className="w-14 h-14 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-6 mx-auto">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </div>

          <h1 className="text-2xl font-semibold text-zinc-50 text-center tracking-tight mb-2">
            This room is private
          </h1>
          <p className="text-sm text-zinc-400 text-center mb-6">
            Enter the password to join{' '}
            <span className="font-mono text-zinc-200">{roomId}</span>.
          </p>

          <form onSubmit={onSubmit}>
            <label className="block text-sm font-medium text-zinc-300 mb-2" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Enter room password"
              autoFocus
              autoComplete="current-password"
              className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition mb-4"
            />
            <button
              type="submit"
              disabled={!passwordInput}
              className="w-full px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-zinc-950"
            >
              Join room
            </button>
          </form>

          {errorMessage && (
            <p className="mt-4 text-sm text-rose-400 text-center" role="alert">
              {errorMessage}
            </p>
          )}

          <Link
            to="/"
            className="block text-center text-sm text-zinc-500 hover:text-zinc-300 transition mt-5"
          >
            ← Back to home
          </Link>
        </div>
      </main>
    </div>
  )
}

// ===================================================================
// EditableChip — your own presence chip. Reads as a static chip with
// a hover pencil icon by default; clicking flips it into an inline
// input with save/cancel buttons. Enter saves, Esc cancels.
// ===================================================================
function EditableChip({ name, colorClass, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  // If the name changes server-side while we're not editing (e.g. another
  // tab edits it), keep the draft in sync so re-opening the input shows
  // the latest. Don't clobber an in-progress draft though.
  useEffect(() => {
    if (!editing) setDraft(name)
  }, [name, editing])

  const commit = () => {
    const trimmed = draft.trim().slice(0, 40)
    if (trimmed && trimmed !== name) {
      onSave(trimmed)
    }
    setEditing(false)
  }

  const cancel = () => {
    setDraft(name)
    setEditing(false)
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-900 ring-1 ring-emerald-400 border border-zinc-800">
        <span
          className={`w-2 h-2 rounded-full ${colorClass}`}
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') cancel()
          }}
          maxLength={40}
          aria-label="Your name"
          className="bg-transparent text-zinc-100 placeholder-zinc-600 focus:outline-none text-sm w-24"
        />
        <button
          onClick={commit}
          className="text-emerald-400 hover:text-emerald-300 transition"
          aria-label="Save name"
          title="Save (Enter)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
        <button
          onClick={cancel}
          className="text-zinc-400 hover:text-rose-400 transition"
          aria-label="Cancel"
          title="Cancel (Esc)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 6L18 18M6 18L18 6" />
          </svg>
        </button>
      </span>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-900 text-zinc-200 ring-1 ring-emerald-400 border border-zinc-800 hover:bg-zinc-800 transition"
      aria-label="Edit your name"
      title="Click to rename"
    >
      <span
        className={`w-2 h-2 rounded-full ${colorClass}`}
        aria-hidden="true"
      />
      <span>{name}</span>
      <span className="text-zinc-500"> (you)</span>
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-zinc-500 opacity-0 group-hover:opacity-100 transition"
        aria-hidden="true"
      >
        <path d="M12 20h9M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    </button>
  )
}

export default Room

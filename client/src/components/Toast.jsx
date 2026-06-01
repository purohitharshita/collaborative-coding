import { useEffect, useState, useCallback, useRef } from 'react'

// Toast variants. Keeping the palette tight — emerald for success,
// rose for errors, zinc for neutral info — so the Room header stays
// readable when multiple toasts could stack.
const VARIANT_STYLES = {
  success: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
  error:   'bg-rose-500/15 border-rose-500/40 text-rose-300',
  info:    'bg-zinc-800 border-zinc-700 text-zinc-200',
}

const VARIANT_ICONS = {
  success: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  error: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
}

// Single toast. Drives its own exit animation so consumers don't have
// to coordinate timing — they just unmount us when our `id` leaves
// the list and we'll play the exit before signalling done.
function ToastItem({ message, variant = 'info' }) {
  return (
    <div
      className={`toast-enter pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-lg border shadow-lg shadow-zinc-950/40 backdrop-blur-sm ${VARIANT_STYLES[variant] || VARIANT_STYLES.info}`}
      role="status"
      aria-live="polite"
    >
      <span className="shrink-0">{VARIANT_ICONS[variant] || VARIANT_ICONS.info}</span>
      <span className="text-sm font-medium">{message}</span>
    </div>
  )
}

// Container — fixed top-right, stacks multiple toasts vertically.
// `pointer-events-none` on the wrapper lets clicks through to whatever
// is behind it; each individual toast restores pointer events.
export function ToastContainer({ toasts }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <ToastItem key={t.id} message={t.message} variant={t.variant} />
      ))}
    </div>
  )
}

// Hook — owns the toast list and provides a stable `showToast` callback.
// Pass `{ message, variant, durationMs }`. Auto-dismisses after
// durationMs (default 2200), early-dismissable via the returned id.
export function useToasts() {
  const [toasts, setToasts] = useState([])
  const nextIdRef = useRef(0)

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback(
    ({ message, variant = 'info', durationMs = 2200 }) => {
      const id = ++nextIdRef.current
      setToasts((current) => [...current, { id, message, variant }])
      setTimeout(() => dismissToast(id), durationMs)
      return id
    },
    [dismissToast]
  )

  // Sweep all toasts on unmount so leftover timers don't fire.
  useEffect(() => {
    return () => setToasts([])
  }, [])

  return { toasts, showToast, dismissToast }
}

import { Link } from 'react-router-dom'
import Logo from './Logo'

const GITHUB_URL = 'https://github.com/purohitharshita/CollaborativeCoding'

// Compact top nav shared between Room error states and (later) the
// working room header. Wordmark links home; GitHub link on the right.
function RoomNav({ children }) {
  return (
    <nav className="px-6 py-4 flex items-center justify-between border-b border-zinc-900">
      <Link to="/" className="flex items-center gap-2 hover:opacity-90 transition">
        <Logo size="md" />
      </Link>

      <div className="flex items-center gap-4">
        {children}
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-zinc-400 hover:text-zinc-100 transition flex items-center gap-1.5"
          aria-label="GitHub repository"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 016 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.48 5.92.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.22.7.83.58A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
        </a>
      </div>
    </nav>
  )
}

export default RoomNav

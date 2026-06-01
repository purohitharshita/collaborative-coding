// Wordmark for CodeRoom. The bracket glyph mirrors the favicon design:
// two square brackets framing an emerald dot — code-environment + "live".
function Logo({ size = 'md' }) {
  const sizes = {
    sm: { icon: 18, text: 'text-base' },
    md: { icon: 22, text: 'text-lg' },
    lg: { icon: 28, text: 'text-2xl' },
  }
  const { icon, text } = sizes[size] || sizes.md

  return (
    <div className="flex items-center gap-2">
      <svg width={icon} height={icon} viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path
          d="M 12 9 L 7 9 L 7 23 L 12 23"
          stroke="#10b981"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M 20 9 L 25 9 L 25 23 L 20 23"
          stroke="#10b981"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="16" cy="16" r="2" fill="#34d399" />
      </svg>
      <span className={`font-semibold tracking-tight text-zinc-50 ${text}`}>
        CodeRoom
      </span>
    </div>
  )
}

export default Logo

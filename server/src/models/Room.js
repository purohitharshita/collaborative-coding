import mongoose from 'mongoose'

const roomSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, unique: true },
    // Per-language code drafts. Each language has its own independent state,
    // so switching languages never destroys work.
    codeByLanguage: {
      type: Map,
      of: String,
      default: () => new Map(),
    },
    // The room's currently-active language. All clients display this.
    language: { type: String, default: 'javascript' },
    passwordHash: { type: String, default: null },

    // DEPRECATED — pre-7.2.5 single-code field. Lazily migrated into
    // codeByLanguage on first read. Safe to drop after all active rooms
    // have been touched once.
    code: { type: String, default: undefined },
  },
  { timestamps: true }
)

export default mongoose.model('Room', roomSchema)

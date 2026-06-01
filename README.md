# Collaborative Coding Platform

A real-time, web-based collaborative code editor. Multiple users join a room and edit the same file together — like Google Docs, but for code.

**🟢 Live demo:** https://collaborative-coding-jade.vercel.app

## Tech Stack

**Frontend:** React (Vite) · Tailwind CSS · Monaco Editor · Socket.IO Client
**Backend:** Node.js · Express.js · Socket.IO
**Database:** MongoDB Atlas
**Code execution:** JDoodle compiler API (6 languages)
**Hosting:** Vercel (frontend) · Render (backend)

## Architecture

```
Browser ──HTTPS──► Vercel (static React bundle)
   │
   └── WSS ──────► Render (Node + Express + Socket.IO) ──HTTPS──► JDoodle API
                      │
                      └── MongoDB Atlas: Room { roomId, codeByLanguage, language, passwordHash, timestamps }

```

Room state is persisted to MongoDB Atlas, so a room's code survives server restarts and free-tier sleep cycles. Real-time edits are broadcast to all sockets in the room (excluding the sender) over WebSocket; DB writes are debounced at 1 write per (room, language) per second to avoid hammering the cluster on every keystroke. Late joiners get the current language's code via a `findOne` lookup on `join-room`.

Active users (presence) are tracked in-memory per room and broadcast to all sockets on join/leave — deliberately not persisted, since presence is ephemeral by definition. Names are prompted on the landing page and stored in `localStorage`; per-user avatar colors are derived deterministically from each socket's ID via a string hash, so every client agrees on who's which color without server coordination.

Rooms are created explicitly via `POST /api/rooms` with an optional password, which is bcrypt-hashed (cost factor 10) before storage — plaintext is never written or logged. Before opening a socket, the client probes `GET /api/rooms/:id` to learn whether the room exists and whether it needs a password; private rooms show an inline prompt, with the entered password cached in `sessionStorage` (tab-scoped) so the creator's immediate navigate and any in-tab reloads connect without re-prompting. Existing rooms from before this change remain public — `passwordHash` defaults to `null`.

Live cursor positions are broadcast over a separate `cursor-move` socket event, throttled client-side to ~20 events per second to keep traffic bounded. Each remote caret renders as a thin colored line at the peer's exact line/column in the editor, in the same color as their avatar chip — derived from the same socket-ID hash, so cursor and chip always match without any server coordination. Cursor positions are never persisted, and prune automatically when a peer leaves.

Each room supports six languages (JavaScript, Python, C++, Java, Go, Rust) with **per-language code storage** — every language has its own independent draft, so switching language never destroys work (LeetCode model). The schema stores code as `codeByLanguage: Map<string, string>`; persistence is keyed by `(roomId, language)` so concurrent edits in different languages don't clobber each other. Legacy rooms from before the multi-language schema are lazily migrated into the new shape on first read. The `code-change` socket payload carries the originating language so peers can filter out edits authored under a now-stale language during a race-y switch (someone hitting a key while another peer is mid-`language-change`).

Code execution runs through the [JDoodle compiler API](https://www.jdoodle.com/compiler-api). Clients POST `/api/execute` with `{ roomId, language, code, stdin, socketId }`; the server authorizes the caller's socket via Socket.IO's room membership map, enforces a 2-second per-room cooldown, calls JDoodle, and broadcasts the result via `execution-result` to other peers (the caller gets their copy through the HTTP response, so there's no double-fire). Stdin is local-only per tab — by design, not synced — letting different users test the same code against different inputs simultaneously. JDoodle merges stdout and stderr into one stream, so the output panel doesn't visually distinguish them. The free tier is 200 executions per day per `clientId`; on quota exhaustion the server returns HTTP 429 and the UI shows "Daily execution limit reached."

## Repository Layout

```
.
├── client/        # React + Vite frontend
│   └── vercel.json    # SPA fallback for client-side routing
├── server/        # Express + Socket.IO backend
├── render.yaml    # Render Blueprint (backend infra-as-code)
└── README.md
```

## Local Development

> Requires Node.js 20+, npm, a MongoDB connection string (free Atlas cluster works fine), and a free JDoodle API key (200 executions/day).

```bash
# 1. Install backend dependencies
cd server
cp .env.example .env       # then edit values if needed
npm install
npm run dev                # API on http://localhost:5000

# 2. In a separate terminal, install frontend dependencies
cd client
cp .env.example .env       # then edit values if needed
npm install
npm run dev                # app on http://localhost:5173
```

## Deployment

Both halves auto-deploy on push to `main`:

- **Frontend → Vercel** — configured via `client/vercel.json`. Set `VITE_SERVER_URL` in the Vercel dashboard to point at the production backend.
- **Backend → Render** — configured via `render.yaml`. Set `CLIENT_URL` as a comma-separated list of allowed origins (the Vercel domain + `http://localhost:5173` for local dev against prod), `MONGODB_URI` to your Atlas connection string, and `JDOODLE_CLIENT_ID` + `JDOODLE_CLIENT_SECRET` for code execution. The server refuses to start without all of these set.
- **Database → MongoDB Atlas** — free M0 cluster. Allowlist `0.0.0.0/0` in Network Access since Render's outbound IPs are dynamic; authentication via database user/password is the primary security layer.
- **Code execution → JDoodle** — sign up at [jdoodle.com/compiler-api](https://www.jdoodle.com/compiler-api), grab a `clientId` and `clientSecret` from the API Credentials tab. Free tier is 200 executions/day per credential pair.

The free tier on Render sleeps after 15 minutes of inactivity; the first request after a cold start takes ~30 seconds to wake the service.

## Status

- ✅ **Phase 1 (complete):** Real-time code sync between connected clients via Socket.IO rooms.
- ✅ **Phase 2 (complete):** Public deployment to Vercel + Render with multi-origin CORS, SPA routing, and infrastructure-as-code.
- ✅ **Phase 3 (complete):** MongoDB persistence with debounced writes; rooms survive server restarts and free-tier sleep cycles.
- ✅ **Phase 4 (complete):** Presence indicators — required name prompt on the landing page, live "in this room" list, and deterministic per-user avatar colors.
- ✅ **Phase 5 (complete):** Password-protected rooms — optional bcrypt-hashed password at creation, REST endpoints for explicit room lifecycle, client probes before connecting.
- ✅ **Phase 6 (complete):** Live cursor positions — each peer's caret renders in their avatar color, throttled to ~20 events per second, ephemeral (never persisted), prunes automatically on disconnect.
- ✅ **Phase 7 (complete):** Multi-language support and code execution — per-language code storage (LeetCode model), Run button + stdin + shared output panel, six languages (JavaScript, Python, C++, Java, Go, Rust) via JDoodle.
- 🚧 **Future:** Conflict-free editing (Yjs CRDT).

## License

MIT

## Known Issues

- `npm audit` reports 2 moderate-severity transitive vulnerabilities in `dompurify` via `monaco-editor`. DOMPurify is patched upstream but `monaco-editor` has not yet bumped its pinned version. Exploits require attacker-controlled HTML/Markdown to reach DOMPurify; our app does not feed external content into Monaco's display layer, so real-world exposure is negligible. Will resolve automatically when `monaco-editor` ships an update.

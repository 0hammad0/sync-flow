<p align="center">
  <img src="public/logo.png" alt="SyncFlow Logo" width="120" height="120">
</p>

<h1 align="center">SyncFlow</h1>

<p align="center">
  Fast, secure file sharing and ephemeral chat — end-to-end encryption, phone-to-PC transfers, and optional AI.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" alt="Next.js">
  <img src="https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Firebase-Auth%20%2B%20Firestore-FFCA28?style=flat-square&logo=firebase" alt="Firebase">
  <img src="https://img.shields.io/badge/Cloudflare-R2-F38020?style=flat-square&logo=cloudflare" alt="Cloudflare R2">
  <img src="https://img.shields.io/badge/Tailwind-CSS-38B2AC?style=flat-square&logo=tailwind-css" alt="Tailwind CSS">
</p>

---

## Features

### File sharing
- **Instant sharing** — Upload and get a shareable link in seconds
- **Multiple files at once** — Upload a batch; each file gets its own share link
- **End-to-end encryption** — AES-256-GCM, the key lives in the URL fragment and never reaches the server
- **Expiring links** — 1 hour, 24 hours, 7 days, 30 days, or never (signed-in users)
- **Download limits** — Self-destructing files after N downloads
- **QR codes & email** — Share a link via QR code or send it by email
- **Progress tracking** — Real-time upload progress with encryption status
- **No account required** — Anonymous uploads supported; sign in (magic link) to manage them in a dashboard

### Phone → PC transfer
- **Scan and send** — Open the receive page, scan the QR with your phone, and files land on your PC automatically
- **Multi-file sessions** — Keep sending files until the session expires
- **Download all** — Grab every received file as a single ZIP

### Chat rooms
- **Ephemeral by design** — Create a room, share the code/QR, and it self-destructs on expiry (1h / 24h / 7d)
- **Real-time** — Live messages, typing indicators, online presence, emoji reactions, and WhatsApp-style replies
- **Attachments & albums** — Share images, video, audio, and files; send several as one album and download them all as a ZIP
- **Rich text** — URLs become clickable links with one-click copy, code is auto-detected and rendered as a syntax-highlighted snippet with a copy button, and long messages get a copy control
- **Mobile-first composer** — Tools collapse into an animated drop-up menu while typing so the input takes the full width

### AI (optional, via OpenRouter)
AI controls appear only when an `OPENROUTER_API_KEY` is configured, and each is user-triggered (never automatic):
- **Smart replies** — Tappable one-line reply suggestions from the recent conversation
- **Catch me up** — A quick summary of what you missed in a busy room
- **Rewrite** — Reword your draft (shorter, friendlier, professional, fix grammar, translate) — streamed back into the composer with undo
- **Translate** — Per-message translation into your language
- **Explain code** — Plain-language explanation of any detected code snippet or error

## Tech Stack

| Technology | Purpose |
|------------|---------|
| [Next.js 16](https://nextjs.org/) | React framework (App Router, Turbopack) |
| [TypeScript](https://www.typescriptlang.org/) | Type safety |
| [Firebase Auth](https://firebase.google.com/docs/auth) | Email-link (passwordless) sign-in |
| [Firestore](https://firebase.google.com/docs/firestore) | File metadata, receive sessions, chat messages/presence |
| [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) | File body storage (S3-compatible, zero egress fees) |
| [Tailwind CSS](https://tailwindcss.com/) | Styling |
| Web Crypto API | AES-256-GCM encryption |
| [qrcode.react](https://npmjs.com/package/qrcode.react) | QR code generation |
| [OpenRouter](https://openrouter.ai/) | Optional AI features (streamed, free-tier friendly) |

## Quick Start

### Prerequisites

- Node.js 20+
- A [Firebase](https://console.firebase.google.com/) project (free Spark plan works)
- A [Cloudflare](https://dash.cloudflare.com/) account with R2 enabled
- *(Optional)* An [OpenRouter](https://openrouter.ai/) account for the AI features

### 1. Clone and install

```bash
git clone https://github.com/yourusername/syncflow.git
cd syncflow
npm install
```

### 2. Set up Firebase

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com/)
2. Enable **Authentication** → **Email/Password** → toggle **Email link (passwordless sign-in)** ON
3. Create a **Firestore database** (production mode is fine — the app uses the Admin SDK server-side)
4. In **Project settings** → **Service accounts** → **Generate new private key** → save the JSON

### 3. Set up Cloudflare R2

1. Enable R2 in the Cloudflare dashboard
2. Create a bucket (e.g. `syncflow-files`, Standard storage, Public Access disabled)
3. Create an **Account API token** with **Object Read & Write** scoped to that bucket
4. Note your **Account ID**, the bucket name, the **Access Key ID**, and the **Secret Access Key**

### 4. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# Firebase — public (client SDK)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=<project-id>
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=<project-id>.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# Firebase Admin (server) — from the service-account JSON
FIREBASE_PROJECT_ID=<project-id>
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@<project-id>.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Cloudflare R2
R2_ACCOUNT_ID=...
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET=syncflow-files
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...

# SMTP (optional — used for "Send via email" share links)
SMTP_USER=you@gmail.com
SMTP_PASS=<gmail-app-password>

# Optional: production URL used in share-link emails
# NEXT_PUBLIC_APP_URL=https://your-app.vercel.app

# Optional: OpenRouter AI features (see below)
# OPENROUTER_API_KEY=sk-or-v1-...
```

### 5. Create Firestore composite indexes

The app issues two multi-field queries that need composite indexes:

- `files: (owner_id ASC, expires_at ASC)` — used by the cleanup cron
- `files: (owner_id ASC, created_at DESC)` — used by the dashboard listing

Easiest: hit each query once in development and click the "Create index" URL Firestore prints in the error. Or deploy `firestore.indexes.json` via the Firebase CLI: `firebase deploy --only firestore:indexes`.

### 6. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Optional: Enable AI features

The AI features (smart replies, room summaries, rewrite, translate, explain code) are powered by [OpenRouter](https://openrouter.ai/) and are **entirely optional** — with no key configured, the app runs exactly as before and no AI controls are shown.

1. Sign up at [openrouter.ai](https://openrouter.ai/) and create a key at [openrouter.ai/keys](https://openrouter.ai/keys).
2. Add it to `.env.local`:
   ```env
   OPENROUTER_API_KEY=sk-or-v1-your-key-here
   ```
3. Restart the dev server. AI controls now appear in the chat.

Everything is driven by [`src/lib/ai-config.ts`](src/lib/ai-config.ts) (task list, prompts, and the free-model fallback chain) plus a few env knobs:

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_API_KEY` | — | Required to enable AI at all |
| `OPENROUTER_MODEL` | `google/gemma-4-31b-it:free` | Primary model; falls back through other free models automatically |
| `AI_TASKS_DISABLED` | — | Comma list to turn tasks off, e.g. `replies,translate` |
| `AI_RATE_LIMIT` | `15` | AI requests per minute per IP |

**Notes:** the API key is only ever used server-side (via `/api/ai`); free models are rate-limited upstream, so the route retries on congestion and only touches unencrypted content — end-to-end encrypted file bodies are never sent to any AI provider.

## Usage

### Upload files

1. Drag and drop files (or click to browse) — select as many as you like
2. (Optional) Toggle encryption, set expiry, or a download limit
3. Click **Upload & Share**
4. Copy each link, show a QR code, or send it by email

### Receive from phone

1. Click **Receive** on the home page
2. Scan the QR code with your phone and pick files
3. Files appear on your PC automatically — download them individually or all as a ZIP

### Chat rooms

1. Click **Chat**, create a room, and share the 8-character code or QR
2. Send messages, attachments, and albums; react and reply
3. The room auto-deletes when it expires

### Manage files

1. Sign in with your email (magic link)
2. View all your uploads in the dashboard
3. Copy links, extend expiry, or delete files

## Project Structure

```
src/
├── app/                        # Next.js App Router
│   ├── api/
│   │   ├── upload/             # File upload endpoint (R2 + Firestore)
│   │   ├── send/               # Phone upload endpoint
│   │   ├── receive/            # Receive session endpoints
│   │   ├── chat/[roomCode]/    # Chat: messages, attachments, reactions, presence, heartbeat
│   │   ├── ai/                 # OpenRouter proxy (streamed) + feature discovery
│   │   ├── session/            # Mint/clear Firebase session cookie
│   │   ├── send-email/         # Email a share link via nodemailer
│   │   └── cleanup/            # Cron: delete expired anonymous files
│   ├── auth/callback/          # Firebase email-link completion
│   ├── chat/[roomCode]/        # Chat room page
│   ├── dashboard/              # User's files
│   ├── login/                  # Magic link login
│   ├── receive/                # QR code for receiving
│   ├── send/[sessionToken]/    # Mobile upload page
│   └── share/[token]/          # Download page
├── components/
│   ├── UploadForm.tsx          # Multi-file upload UI
│   ├── ChatRoom.tsx            # Chat room (messages, composer, presence, AI)
│   ├── MessageContent.tsx      # Link/code detection, copy buttons, code explain
│   └── ...
├── actions/                    # Server actions
├── lib/
│   ├── crypto.ts               # AES-256-GCM (Web Crypto API)
│   ├── zip.ts                  # Dependency-free ZIP writer for "Download all"
│   ├── ai-config.ts            # AI tasks, prompts, model fallback (server)
│   ├── ai-client.ts            # AI streaming client + output cleanup (browser)
│   ├── rate-limit.ts           # In-memory sliding-window rate limiter
│   ├── firebase/
│   │   ├── admin.ts            # Firebase Admin SDK init
│   │   ├── client.ts           # Firebase web SDK init
│   │   ├── session.ts          # httpOnly session-cookie helpers
│   │   ├── files.ts            # Firestore CRUD for files / receive_sessions
│   │   └── chat.ts             # Firestore CRUD for chat rooms/messages
│   ├── r2.ts                   # Cloudflare R2 client + signed URLs
│   └── utils.ts                # Helpers
└── types/                      # TypeScript types
```

## Security

| Feature | Description |
|---------|-------------|
| Private R2 bucket | Public Access disabled; downloads only via signed URLs |
| Signed URLs | Download links expire after 1 hour |
| E2E encryption | Keys stored in the URL fragment, never sent to the server |
| Firebase session cookies | `httpOnly`, validated server-side via Admin SDK |
| Firestore security rules | Writes are server-only via Admin SDK |
| CSRF protection | Built into Next.js Server Actions |
| AI privacy | The OpenRouter key stays server-side; only unencrypted content is ever sent, and only on explicit user action |

## Scripts

```bash
npm run dev      # Start development server (Turbopack)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

The `scripts/` folder also contains Puppeteer-based end-to-end checks (`e2e-chat.mjs`, `e2e-encrypted-download.mjs`, `e2e-mobile-responsive.mjs`, `e2e-cleanup.mjs`) and a Firestore-rules deploy helper.

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add all environment variables from `.env.local` (note: `FIREBASE_PRIVATE_KEY` newline handling — paste as-is including the literal `\n` sequences inside double quotes). Add `OPENROUTER_API_KEY` too if you want the AI features.
4. Deploy

The included `vercel.json` schedules `/api/cleanup` daily at 03:00 UTC to purge expired anonymous files.

## Contributing

Contributions are welcome! Please open an issue or submit a PR.

## License

MIT

---

<p align="center">
  Built with <a href="https://nextjs.org">Next.js</a>, <a href="https://firebase.google.com">Firebase</a>, and <a href="https://www.cloudflare.com/developer-platform/r2/">Cloudflare R2</a>
</p>

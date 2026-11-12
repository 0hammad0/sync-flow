<p align="center">
  <img src="public/logo.png" alt="SyncFlow Logo" width="120" height="120">
</p>

<h1 align="center">SyncFlow</h1>

<p align="center">
  Fast, secure file sharing and ephemeral chat — end-to-end encryption, phone-to-PC transfers, and optional AI.
</p>

<p align="center">
  <a href="https://github.com/0hammad0/sync-flow/actions/workflows/ci.yml"><img src="https://github.com/0hammad0/sync-flow/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
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
- **End-to-end encryption, on by default** — AES-256-GCM in the browser; the key lives in the URL fragment and never reaches the server (can be switched off per upload)
- **Expiring links** — 1 hour, 24 hours or 7 days for everyone; signed-in users can also pick 30 days or never
- **Download limits** — Self-destructing files after N downloads
- **QR codes & email** — Share a link via QR code or send it by email
- **Progress tracking** — Real-time upload progress with encryption status
- **No account required** — Anonymous uploads supported; sign in (magic link) to manage them in a dashboard
- **Limits** — 100 MB per file; up to 1,000 downloads per link; a signed-in account keeps up to 10 files

### Phone → PC transfer
- **Scan and send** — Open the receive page, scan the QR with your phone, and files land on your PC automatically
- **Multi-file sessions** — Up to 25 files (100 MB each) per session; sessions last 10 minutes
- **Late files still arrive** — A file that finishes uploading just after the session ends still shows up (15-minute grace)
- **Guest files are temporary** — Without an account, received files are kept for 24 hours
- **Not end-to-end encrypted** — Transfers are encrypted in transit (HTTPS) and kept in private storage
- **Download all** — Grab every received file as a single ZIP

### Chat rooms
- **Ephemeral by design** — Create a room, share the code/QR, and it self-destructs on expiry (1h / 24h / 7d)
- **Not end-to-end encrypted** — Messages and attachments are encrypted in transit and stored privately until the room expires
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

- Node.js 22+ (firebase-admin 14 needs it)
- A [Firebase](https://console.firebase.google.com/) project (free Spark plan works)
- A [Cloudflare](https://dash.cloudflare.com/) account with R2 enabled
- *(Optional)* An [OpenRouter](https://openrouter.ai/) account for the AI features

### 1. Clone and install

```bash
git clone https://github.com/0hammad0/sync-flow.git
cd sync-flow
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
5. Add a **CORS policy** to the bucket (bucket → Settings → CORS Policy). Browsers upload straight to R2 with presigned `PUT` URLs (this avoids the ~4.5 MB request-body cap of serverless hosts like Vercel), and encrypted downloads are fetched and decrypted in the browser with `GET`:

   ```json
   [
     {
       "AllowedOrigins": ["https://your-app.vercel.app", "http://localhost:3000"],
       "AllowedMethods": ["GET", "HEAD", "PUT"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   List **every origin that uploads**: your production domain, any custom domain, and `http://localhost:3000`. Vercel preview URLs are not covered unless you add them, so uploads fail on previews.

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

# Required in production: protects the daily cleanup cron (/api/cleanup)
# CRON_SECRET=<16+ random letters and digits>

# Optional: OpenRouter AI features (see below)
# OPENROUTER_API_KEY=sk-or-v1-...
```

### 5. Deploy Firestore rules and indexes

The app issues three multi-field queries that need composite indexes:

- `files: (owner_id ASC, expires_at ASC)` — used by the cleanup cron
- `files: (owner_id ASC, created_at DESC)` — used by the dashboard listing
- `rooms: (created_by ASC, created_at DESC)` — used by "My chat rooms"

Deploy `firestore.indexes.json` with the Firebase CLI: `firebase deploy --only firestore:indexes`. Or hit each query once in development and click the "Create index" URL Firestore prints in the error.

Deploy the security rules in `firestore.rules` too. Hosting (Vercel) does **not** deploy them:

```bash
firebase deploy --only firestore:rules
# or, without the Firebase CLI (uses the service account in .env.local):
node scripts/deploy-firestore-rules.mjs --deploy
```

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

Everything is driven by [`src/features/ai/lib/ai-config.ts`](src/features/ai/lib/ai-config.ts) (task list, prompts, and the free-model fallback chain) plus a few env knobs:

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_API_KEY` | — | Required to enable AI at all |
| `OPENROUTER_MODEL` | `google/gemma-4-31b-it:free` | Primary model; falls back through other free models automatically |
| `AI_TASKS_DISABLED` | — | Comma list to turn tasks off, e.g. `replies,translate` |
| `AI_RATE_LIMIT` | `15` | AI requests per minute per IP |
| `AI_DAILY_LIMIT` | `500` | Total AI requests per day, per server instance |

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

The codebase is organized by **feature** (`features/*`) with cross-cutting UI
and infrastructure in `shared/*`. Every import uses the `@/` path alias
(`@/* → src/*`), so modules are location-independent.

```
src/
├── app/                          # Next.js App Router — routes only (thin)
│   ├── api/
│   │   ├── upload/               # Share uploads: presign → browser PUT to R2 → complete
│   │   ├── send/                 # Phone → PC uploads: code, presign, complete
│   │   ├── receive/              # Receive session endpoints
│   │   ├── chat/[roomCode]/      # Chat: messages, attachments, reactions, presence, heartbeat
│   │   ├── ai/                   # OpenRouter proxy (streamed) + feature discovery
│   │   ├── session/              # Mint/clear Firebase session cookie
│   │   ├── send-email/           # Email a share link via nodemailer
│   │   └── cleanup/              # Daily cron: expired guest files, sessions, rooms
│   ├── chat/[roomCode]/          # Chat room page
│   ├── dashboard/                # User's files
│   ├── login/  receive/  send/[sessionToken]/  share/[token]/  auth/callback/
│   └── layout.tsx  page.tsx  globals.css
│
├── features/                     # Feature modules (components + feature libs)
│   ├── ai/lib/                   # ai-client (browser), ai-config (server prompts/models)
│   ├── chat/
│   │   ├── components/           # ChatRoom, MessageBubble, MediaViewer, MessageContent, ChatLobby, MyChatRooms
│   │   ├── lib/chat-helpers.ts   # Shared chat constants + pure helpers
│   │   └── server/               # Chat attachment upload rules
│   ├── files/
│   │   ├── components/           # UploadForm, FileList, DownloadCard, ProgressBar, QRModal
│   │   └── server/               # files.ts (server actions), share-upload.ts, send-upload.ts
│   └── landing/                  # Home page: hero scenes, tool tabs, HomeUpload
│
├── shared/                       # Cross-cutting, feature-agnostic
│   ├── components/               # Header, Logo, ThemeToggle, CopyButton, LoadingSpinner, Reveal, AuthCTA
│   │   └── ui/Button.tsx
│   └── lib/
│       ├── crypto.ts             # AES-256-GCM (Web Crypto API)
│       ├── clipboard.ts          # copyText + useCopy hook
│       ├── zip.ts                # Dependency-free ZIP writer for "Download all"
│       ├── rate-limit.ts         # In-memory rate limiter + shared 429 reply
│       ├── limits.ts             # Upload size, expiry choices, caps (client + server)
│       ├── upload-ticket.ts      # Signed tickets: presign → complete
│       ├── direct-upload.ts      # Browser PUT to R2 with progress and cancel
│       ├── safe-next.ts          # Safe "return to" path after sign-in
│       ├── auth-state.ts  site.ts
│       ├── r2.ts  time.ts  utils.ts
│       └── firebase/             # admin, client, session, files, chat, proxy
│
├── proxy.ts                      # Next.js proxy (session refresh on every request)
└── types/                        # Shared TypeScript types
```

## Security

| Feature | Description |
|---------|-------------|
| Private R2 bucket | Public Access disabled; downloads only via signed URLs |
| Signed URLs | Download links expire after 1 hour |
| E2E encryption | Keys stored in the URL fragment, never sent to the server |
| Firebase session cookies | `httpOnly`, validated server-side via Admin SDK |
| Firestore security rules | Writes are server-only via Admin SDK; chat is readable only by room code, only while the room is live |
| CSRF protection | Built into Next.js Server Actions; the session route only accepts JSON from the site's own origin |
| Signed upload tickets | Presign issues an HMAC-signed ticket; complete checks it and the stored size before saving |
| Limits enforced on the server | File size, expiry and download limit are checked by the server, not only the form; per-account file caps are re-checked at save time, in a transaction |
| Rate limits | Per-IP limits on uploads, codes, email, chat and AI |
| Cron secret | `/api/cleanup` refuses every call without `CRON_SECRET` |
| Chat identity | Each browser keeps a secret device id; rooms store only its SHA-256 hash, so a hash read from a room can't be used to act as that device |
| Chat attachments | Each uploaded file gets a signed proof; a message can only attach files with a valid proof, and each file only once |
| AI privacy | The OpenRouter key stays server-side; only unencrypted content is ever sent, and only on explicit user action |

## Scripts

```bash
npm run dev        # Start development server (Turbopack)
npm run build      # Production build
npm run start      # Start production server
npm run lint       # Run ESLint
npm run typecheck  # Type-check with tsc (no emit)
```

The `scripts/` folder also contains Puppeteer-based end-to-end checks (`e2e-chat.mjs`, `e2e-encrypted-download.mjs`, `e2e-mobile-responsive.mjs`, `e2e-cleanup.mjs`) and a Firestore-rules deploy helper.

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add all environment variables from `.env.local` (note: `FIREBASE_PRIVATE_KEY` newline handling — paste as-is including the literal `\n` sequences inside double quotes). Add `OPENROUTER_API_KEY` too if you want the AI features. Add `CRON_SECRET` (see below).
4. Set the project's Node.js version to 22.x or newer (Settings → Build and Deployment)
5. Deploy
6. Deploy the Firestore rules and indexes (step 5 of Quick Start) — Vercel does not do this
7. Add your production domain to the R2 CORS policy (step 3 of Quick Start)

The included `vercel.json` schedules `/api/cleanup` daily at 03:00 UTC. It removes expired guest files, old Phone → PC sessions and expired chat rooms. **Set `CRON_SECRET`** in Vercel (16+ random letters and digits). Vercel sends it with each cron call, and the route refuses every call without it.

## Contributing

Contributions are welcome! Please open an issue or submit a PR.

## License

MIT

---

<p align="center">
  Built with <a href="https://nextjs.org">Next.js</a>, <a href="https://firebase.google.com">Firebase</a>, and <a href="https://www.cloudflare.com/developer-platform/r2/">Cloudflare R2</a>
</p>

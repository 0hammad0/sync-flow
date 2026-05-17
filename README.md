<p align="center">
  <img src="public/logo.png" alt="SyncFlow Logo" width="120" height="120">
</p>

<h1 align="center">SyncFlow</h1>

<p align="center">
  Fast, secure file sharing with end-to-end encryption and seamless device transfers.
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

- **Instant File Sharing** — Upload and get a shareable link in seconds
- **End-to-End Encryption** — AES-256-GCM encryption, key never leaves your browser
- **Phone to PC Transfer** — Scan QR code to send files from phone to computer
- **QR Code Sharing** — Generate QR codes for easy mobile sharing
- **Expiring Links** — Set links to expire after 1 hour, 24 hours, 7 days, or 30 days
- **Download Limits** — Self-destructing files after N downloads
- **Progress Tracking** — Real-time upload progress with encryption status
- **No Account Required** — Anonymous uploads supported
- **Magic Link Auth** — Passwordless sign-in via email

## Tech Stack

| Technology | Purpose |
|------------|---------|
| [Next.js 16](https://nextjs.org/) | React framework (App Router) |
| [TypeScript](https://www.typescriptlang.org/) | Type safety |
| [Firebase Auth](https://firebase.google.com/docs/auth) | Email-link (passwordless) sign-in |
| [Firestore](https://firebase.google.com/docs/firestore) | File metadata + receive sessions |
| [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) | File body storage (S3-compatible, zero egress fees) |
| [Tailwind CSS](https://tailwindcss.com/) | Styling |
| Web Crypto API | AES-256-GCM encryption |
| [qrcode.react](https://npmjs.com/package/qrcode.react) | QR code generation |

## Quick Start

### Prerequisites

- Node.js 20+
- A [Firebase](https://console.firebase.google.com/) project (free Spark plan works)
- A [Cloudflare](https://dash.cloudflare.com/) account with R2 enabled

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

## Usage

### Upload a File

1. Drag and drop a file or click to browse
2. (Optional) Enable encryption, set expiry, or download limit
3. Click **Upload & Share**
4. Copy the link or share via QR code

### Receive from Phone

1. Click **Receive** on the home page
2. Scan the QR code with your phone
3. Select a file on your phone
4. File appears on your PC automatically

### Manage Files

1. Sign in with your email (magic link)
2. View all your uploads in the dashboard
3. Copy links, extend expiry, or delete files

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/
│   │   ├── upload/         # File upload endpoint (R2 + Firestore)
│   │   ├── send/           # Phone upload endpoint
│   │   ├── receive/        # Receive session endpoints
│   │   ├── session/        # Mint/clear Firebase session cookie
│   │   ├── send-email/     # Email a share link via nodemailer
│   │   └── cleanup/        # Cron: delete expired anonymous files
│   ├── auth/callback/      # Firebase email-link completion
│   ├── dashboard/          # User's files
│   ├── login/              # Magic link login
│   ├── receive/            # QR code for receiving
│   ├── send/[sessionToken] # Mobile upload page
│   └── share/[token]/      # Download page
├── components/             # React components
├── actions/                # Server actions
├── lib/
│   ├── crypto.ts           # AES-256-GCM (Web Crypto API)
│   ├── firebase/
│   │   ├── admin.ts        # Firebase Admin SDK init
│   │   ├── client.ts       # Firebase web SDK init
│   │   ├── session.ts      # httpOnly session-cookie helpers
│   │   ├── files.ts        # Firestore CRUD for files / receive_sessions
│   │   └── proxy.ts        # Route protection
│   ├── r2.ts               # Cloudflare R2 client + signed URLs
│   └── utils.ts            # Helpers
└── types/                  # TypeScript types
```

## Security

| Feature | Description |
|---------|-------------|
| Private R2 bucket | Public Access disabled; downloads only via signed URLs |
| Signed URLs | Download links expire after 1 hour |
| E2E Encryption | Keys stored in URL fragment, never sent to server |
| Firebase session cookies | `httpOnly`, validated server-side via Admin SDK |
| Firestore security rules | Writes server-only via Admin SDK |
| CSRF Protection | Built into Next.js Server Actions |

## Scripts

```bash
npm run dev      # Start development server
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add all environment variables from `.env.local` (note: `FIREBASE_PRIVATE_KEY` newline handling — paste as-is including the literal `\n` sequences inside double quotes)
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

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  Eye,
  FileUp,
  Github,
  Lock,
  MessagesSquare,
  Minus,
  Plus,
  ShieldCheck,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import '@/features/landing/landing.css';
import HomeUpload from '@/features/landing/HomeUpload';
import ToolTabs, { type ToolTab } from '@/features/landing/ToolTabs';
import Scene from '@/features/landing/Scene';
import { ChatScene, PhoneScene, ShareScene, WaveLines } from '@/features/landing/scenes';
import { FAQ } from '@/features/landing/content';
import AuthCTA from '@/shared/components/AuthCTA';
import { ISSUES_URL, LICENSE_URL, REPO_URL, siteUrl } from '@/shared/lib/site';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

const WRAP = 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8';
const H2 =
  'font-display text-[1.875rem] leading-[1.1] sm:text-4xl lg:text-[2.75rem] font-bold tracking-[-0.03em] text-fg text-balance';
const LEDE = 'mt-4 text-base sm:text-lg leading-relaxed text-fg-muted max-w-2xl text-pretty';

/* ------------------------------------------------------------------ */
/* Hero: the three tools                                               */
/* ------------------------------------------------------------------ */

const HERO_TOOLS: {
  name: string;
  href: string;
  icon: LucideIcon;
  text: string;
  e2e: boolean;
  security: string;
}[] = [
  {
    name: 'Share files',
    href: '#upload',
    icon: FileUp,
    text: 'Turn any file into a private link, up to 100 MB each.',
    e2e: true,
    security: 'End-to-end encrypted by default',
  },
  {
    name: 'Phone → PC',
    href: '/receive',
    icon: Smartphone,
    text: 'Scan a QR code and files land on this computer.',
    e2e: false,
    security: 'Encrypted in transit, not end-to-end',
  },
  {
    name: 'Chat rooms',
    href: '/chat',
    icon: MessagesSquare,
    text: 'Temporary rooms with files, reactions and replies.',
    e2e: false,
    security: 'Encrypted in transit, not end-to-end',
  },
];

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

const iconSm = 'h-4 w-4';

const HOW_IT_WORKS: ToolTab[] = [
  {
    id: 'share',
    label: 'Share files',
    icon: <FileUp className={iconSm} aria-hidden="true" />,
    scene: <ShareScene />,
    captions: ['Your browser', 'Encrypted here', 'Share link'],
    steps: [
      {
        title: 'Drop your files',
        text: 'Up to 100 MB each. Encryption is on by default and runs in your browser before anything is uploaded.',
      },
      {
        title: 'Set the rules',
        text: 'Pick when the link expires, and optionally how many downloads it allows.',
      },
      {
        title: 'Send the link',
        text: 'Copy it, show it as a QR code or email it. The key travels after the # in the link, a part browsers never send to a server.',
      },
    ],
    cta: { label: 'Share a file', href: '#upload' },
    note: {
      icon: <ShieldCheck className="h-4 w-4 text-brand-text" aria-hidden="true" />,
      text: 'End-to-end encrypted by default',
    },
  },
  {
    id: 'phone',
    label: 'Phone → PC',
    icon: <Smartphone className={iconSm} aria-hidden="true" />,
    scene: <PhoneScene />,
    captions: ['Your phone', 'QR code on your PC', 'Files on your PC'],
    steps: [
      {
        title: 'Open Phone → PC on your computer',
        text: 'A QR code appears. The session stays open for 10 minutes.',
      },
      {
        title: 'Scan it with your phone',
        text: 'Use the camera app. No app to install, no cable, no pairing.',
      },
      {
        title: 'Pick files on your phone',
        text: 'Up to 25 files per session arrive on the PC. Download them one by one or all at once as a ZIP.',
      },
    ],
    cta: { label: 'Open Phone → PC', href: '/receive' },
    note: {
      icon: <Lock className="h-4 w-4" aria-hidden="true" />,
      text: 'Encrypted in transit, not end-to-end',
    },
  },
  {
    id: 'chat',
    label: 'Chat rooms',
    icon: <MessagesSquare className={iconSm} aria-hidden="true" />,
    scene: <ChatScene />,
    captions: ['Messages, files and reactions', 'Room expires'],
    steps: [
      {
        title: 'Create a room',
        text: 'Choose how long it lives: 1 hour, 24 hours or 7 days.',
      },
      {
        title: 'Share the code',
        text: 'Anyone with the room code or link can join under a display name. No accounts.',
      },
      {
        title: 'Talk, then let it go',
        text: 'Real-time messages, attachments, reactions and replies. When the room expires, it is deleted with everything in it.',
      },
    ],
    cta: { label: 'Start a chat room', href: '/chat' },
    note: {
      icon: <Lock className="h-4 w-4" aria-hidden="true" />,
      text: 'Encrypted in transit, not end-to-end',
    },
  },
];

/* ------------------------------------------------------------------ */
/* What we can see                                                     */
/* ------------------------------------------------------------------ */

type Tone = 'private' | 'visible' | 'none' | 'info';
type Cell = { tone: Tone; head: string; text?: string };

const TOOL_COLUMNS = ['Share files', 'Phone → PC', 'Chat rooms'] as const;

const VISIBILITY: { label: string; cells: [Cell, Cell, Cell] }[] = [
  {
    label: 'Encryption',
    cells: [
      { tone: 'private', head: 'End-to-end, on by default', text: 'AES-256-GCM in your browser. You can switch it off per upload.' },
      { tone: 'visible', head: 'In transit only', text: 'HTTPS on the way, private storage at rest. Not end-to-end.' },
      { tone: 'visible', head: 'In transit only', text: 'HTTPS on the way, private storage at rest. Not end-to-end.' },
    ],
  },
  {
    label: 'File and message contents',
    cells: [
      { tone: 'private', head: 'We can’t see them', text: 'With encryption on, we only ever store ciphertext.' },
      { tone: 'visible', head: 'We can see them', text: 'Our servers can read the files you send.' },
      { tone: 'visible', head: 'We can see them', text: 'Messages and attachments, until the room expires.' },
    ],
  },
  {
    label: 'Names, sizes and times',
    cells: [
      { tone: 'visible', head: 'We can see them', text: 'File name, size, type, upload time and download count.' },
      { tone: 'visible', head: 'We can see them', text: 'File name, size, type and upload time.' },
      { tone: 'visible', head: 'We can see them', text: 'Display names, timestamps and attachment names.' },
    ],
  },
  {
    label: 'The decryption key',
    cells: [
      { tone: 'private', head: 'Never sent to us', text: 'It lives after the # in the link, which browsers keep to themselves.' },
      { tone: 'none', head: 'No key', text: 'Not end-to-end encrypted.' },
      { tone: 'none', head: 'No key', text: 'Not end-to-end encrypted.' },
    ],
  },
  {
    label: 'Who can open it',
    cells: [
      { tone: 'info', head: 'Anyone with the full link', text: 'Treat the link like the file. Add an expiry or a download limit.' },
      { tone: 'info', head: 'Anyone with the session link', text: 'That is what the QR code holds. It stops accepting files after 10 minutes.' },
      { tone: 'info', head: 'Anyone with the room code', text: 'Rooms close after 1 hour, 24 hours or 7 days.' },
    ],
  },
  {
    label: 'Sent to AI',
    cells: [
      { tone: 'private', head: 'Never' },
      { tone: 'private', head: 'Never' },
      { tone: 'info', head: 'Only when you click an AI action', text: 'If the server has AI turned on, that action’s text goes to OpenRouter and the model that answers.' },
    ],
  },
];

const TONE: Record<Tone, { icon: LucideIcon; className: string }> = {
  private: { icon: ShieldCheck, className: 'text-brand-text' },
  visible: { icon: Eye, className: 'text-fg' },
  none: { icon: Minus, className: 'text-fg-faint' },
  info: { icon: Check, className: 'text-fg-muted' },
};

function VisibilityCell({ cell }: { cell: Cell }) {
  const { icon: Icon, className } = TONE[cell.tone];
  return (
    <div className="flex gap-2.5">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} aria-hidden="true" />
      <div>
        <p className={`text-sm font-semibold ${cell.tone === 'private' ? 'text-brand-text' : 'text-fg'}`}>
          {cell.head}
        </p>
        {cell.text && <p className="mt-1 text-sm leading-relaxed text-fg-muted">{cell.text}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

const LIMITS: { label: string; value: string; detail: string }[] = [
  { label: 'File size', value: '100 MB', detail: 'Per file, in every tool.' },
  { label: 'Share link expiry', value: '1h · 24h · 7d', detail: 'Signed in, you can also pick 30 days or never.' },
  { label: 'Phone → PC', value: '25 files', detail: 'Per session. Each session is open for 10 minutes.' },
  { label: 'Chat rooms', value: '1h · 24h · 7d', detail: 'Then deleted, with every message and attachment.' },
  { label: 'My Files', value: '10 files', detail: 'Kept in your account when you sign in.' },
  { label: 'Download limit', value: 'Optional', detail: 'Cap how many times a share link can be used.' },
];

/* ------------------------------------------------------------------ */
/* Structured data                                                     */
/* ------------------------------------------------------------------ */

function jsonLd() {
  const url = siteUrl().toString();
  const data = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'SyncFlow',
      url,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any (web browser)',
      browserRequirements: 'Requires a modern web browser with JavaScript.',
      description:
        'Share files with end-to-end encrypted links, send files from your phone to your PC with a QR code, or open a temporary chat room.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      license: 'https://opensource.org/licenses/MIT',
      codeRepository: REPO_URL,
      featureList: [
        'End-to-end encrypted file sharing (AES-256-GCM), on by default',
        'Phone to PC transfers with a QR code',
        'Temporary chat rooms with attachments, reactions and replies',
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ];
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

const externalLink =
  'font-medium text-brand-text underline underline-offset-4 decoration-brand-text/40 hover:decoration-brand-text';

export default function Home() {
  return (
    <div data-fullbleed>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd() }} />

      {/* ============================ Hero ============================ */}
      <section aria-labelledby="hero-title">
        <div
          className={`${WRAP} grid gap-10 pt-8 pb-16 sm:pt-14 sm:pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:gap-16 lg:pt-20`}
        >
          <div className="animate-fade-in">
            <h1
              id="hero-title"
              className="font-display text-[2.25rem] leading-[1.04] sm:text-6xl lg:text-[4.25rem] font-bold tracking-[-0.035em] text-fg text-balance"
            >
              Share files <span className="text-brand-text">privately</span>, straight from your
              browser.
            </h1>
            <p className="mt-5 sm:mt-6 max-w-xl text-base sm:text-lg leading-relaxed text-fg-muted text-pretty">
              Send a file as an end-to-end encrypted link, move photos from your phone to this PC
              with a QR code, or open a chat room that deletes itself. Free and open source. No
              account, no app.
            </p>

            <ul
              aria-label="Tools"
              className="mt-8 sm:mt-10 max-w-xl divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface/80 shadow-[var(--shadow-card)]"
            >
              {HERO_TOOLS.map(({ name, href, icon: Icon, text, e2e, security }) => (
                <li key={name}>
                  <Link
                    href={href}
                    className="group flex items-center gap-4 px-4 py-4 sm:px-5 transition-colors duration-200 hover:bg-surface-2/70"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand-text">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-fg">{name}</span>
                      <span className="mt-0.5 block text-sm text-fg-muted">{text}</span>
                      <span
                        className={`mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium ${
                          e2e ? 'text-brand-text' : 'text-fg-faint'
                        }`}
                      >
                        {e2e ? (
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {security}
                      </span>
                    </span>
                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-fg-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-fg"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>

            <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-fg-muted">
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-fg transition-colors">
                <Github className="h-4 w-4" aria-hidden="true" />
                Open source on GitHub
                <span className="sr-only">(opens in a new tab)</span>
              </a>
              <span aria-hidden="true" className="text-fg-faint">·</span>
              <span>MIT licence</span>
              <span aria-hidden="true" className="text-fg-faint">·</span>
              <span>No sign-up</span>
            </p>
          </div>

          <div id="upload" className="animate-slide-up lg:pt-2">
            <h2 className="sr-only">Share a file</h2>
            <HomeUpload />
            <AuthCTA className="mt-5 px-1" />
          </div>
        </div>
      </section>

      {/* ======================== How it works ======================== */}
      <section id="how-it-works" aria-labelledby="how-title" className="border-t border-edge">
        <div className={`${WRAP} py-16 sm:py-24`}>
          <h2 id="how-title" className={H2}>
            How it works
          </h2>
          <p className={LEDE}>Three tools, three steps each. Pick one to see it in motion.</p>
          <div className="mt-8 sm:mt-10">
            <ToolTabs tools={HOW_IT_WORKS} />
          </div>
        </div>
      </section>

      {/* ===================== What we can see ======================= */}
      <section id="security" aria-labelledby="security-title" className="border-t border-edge bg-surface/40">
        <div className={`${WRAP} py-16 sm:py-24`}>
          <h2 id="security-title" className={H2}>
            What we can see, and what we can&apos;t
          </h2>
          <p className={LEDE}>
            Only file shares are end-to-end encrypted. Phone → PC and chat rooms are encrypted in
            transit and kept in private storage, which means our servers can read them. Here is
            the whole picture, per tool.
          </p>

          {/* Desktop: one comparison table */}
          <div className="mt-10 hidden md:block overflow-hidden rounded-2xl border border-edge bg-surface">
            <table className="w-full table-fixed border-collapse text-left">
              <caption className="sr-only">What SyncFlow can and cannot see, for each tool</caption>
              <thead>
                <tr className="border-b border-edge bg-surface-2/60">
                  <th scope="col" className="w-[19%] px-5 py-4 text-sm font-semibold text-fg-muted">
                    <span className="sr-only">Question</span>
                  </th>
                  {TOOL_COLUMNS.map((t) => (
                    <th key={t} scope="col" className="px-5 py-4 font-display text-base font-bold tracking-tight text-fg">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {VISIBILITY.map((row) => (
                  <tr key={row.label} className="border-b border-edge last:border-b-0 align-top">
                    <th scope="row" className="px-5 py-5 text-sm font-medium text-fg-muted">
                      {row.label}
                    </th>
                    {row.cells.map((cell, i) => (
                      <td key={i} className="px-5 py-5">
                        <VisibilityCell cell={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: the same facts, one block per tool */}
          <div className="mt-8 space-y-4 md:hidden">
            {TOOL_COLUMNS.map((tool, col) => (
              <div key={tool} className="rounded-2xl border border-edge bg-surface p-5">
                <h3 className="font-display text-lg font-bold tracking-tight text-fg">{tool}</h3>
                <dl className="mt-4 space-y-4">
                  {VISIBILITY.map((row) => (
                    <div key={row.label} className="border-t border-edge pt-4 first:border-t-0 first:pt-0">
                      <dt className="text-xs font-medium text-fg-muted">{row.label}</dt>
                      <dd className="mt-1.5">
                        <VisibilityCell cell={row.cells[col]} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =========================== Limits ========================== */}
      <section id="limits" aria-labelledby="limits-title" className="border-t border-edge">
        <div className={`${WRAP} py-16 sm:py-24`}>
          <h2 id="limits-title" className={H2}>
            Limits
          </h2>
          <p className={LEDE}>The numbers that matter, before you run into them.</p>
          <dl className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-edge bg-edge sm:grid-cols-2 lg:grid-cols-3">
            {LIMITS.map((l) => (
              <div key={l.label} className="bg-surface p-5 sm:p-6">
                <dt className="text-sm text-fg-muted">{l.label}</dt>
                <dd className="mt-2">
                  <span className="block font-mono text-2xl sm:text-[1.75rem] font-medium tracking-tight text-fg tabular-nums">
                    {l.value}
                  </span>
                  <span className="mt-1.5 block text-sm text-fg-muted">{l.detail}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ======================== Open source ======================== */}
      <section aria-labelledby="oss-title" className="border-y border-edge bg-surface/60">
        <div className={`${WRAP} flex flex-col gap-6 py-12 sm:py-14 lg:flex-row lg:items-center lg:justify-between`}>
          <div className="max-w-2xl">
            <h2 id="oss-title" className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-fg">
              Open source, MIT licensed
            </h2>
            <p className="mt-3 text-base leading-relaxed text-fg-muted text-pretty">
              Read the exact code that encrypts your files, report a problem, or run your own
              copy. No plans to compare, nothing to upgrade.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-fg px-5 text-sm font-semibold text-canvas transition-opacity duration-200 hover:opacity-90"
            >
              <Github className="h-4 w-4" aria-hidden="true" />
              View source on GitHub
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            <a
              href={LICENSE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-edge-strong px-5 text-sm font-semibold text-fg transition-colors duration-200 hover:bg-surface-2"
            >
              Read the licence
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </div>
      </section>

      {/* ============================ FAQ ============================ */}
      <section id="faq" aria-labelledby="faq-title">
        <div className={`${WRAP} grid gap-10 py-16 sm:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16`}>
          <div>
            <h2 id="faq-title" className={H2}>
              Questions, answered
            </h2>
            <p className="mt-4 text-base leading-relaxed text-fg-muted">
              Something missing?{' '}
              <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer" className={externalLink}>
                Ask on GitHub Issues
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              .
            </p>
          </div>
          <div className="divide-y divide-edge border-y border-edge">
            {FAQ.map((f) => (
              <details key={f.q} className="faq">
                <summary className="flex cursor-pointer items-center justify-between gap-4 py-5 text-left font-semibold text-fg transition-colors hover:text-brand-text">
                  <h3 className="text-base sm:text-lg">{f.q}</h3>
                  <Plus className="faq-icon h-5 w-5 shrink-0 text-fg-faint" aria-hidden="true" />
                </summary>
                <p className="-mt-1 pb-6 pr-8 text-base leading-relaxed text-fg-muted max-w-prose">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ========================= Final CTA ========================= */}
      <section aria-labelledby="cta-title" className="border-t border-edge">
        <Scene className="h-20 sm:h-28 w-full opacity-80" threshold={0.5}>
          <WaveLines />
        </Scene>
        <div className={`${WRAP} pb-6 pt-6 sm:pt-8 text-center`}>
          <h2 id="cta-title" className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-[-0.035em] text-fg text-balance">
            Drop a file. Get a link. Done.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-base sm:text-lg text-fg-muted text-pretty">
            No sign-up and nothing to install. Pick the tool that fits what you are moving.
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Link
              href="#upload"
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-flow px-6 text-base font-semibold text-white shadow-md transition-[filter,box-shadow] duration-200 hover:brightness-110 hover:shadow-[var(--glow)]"
            >
              <FileUp className="h-5 w-5" aria-hidden="true" />
              Share files
            </Link>
            <Link
              href="/receive"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-edge-strong bg-surface px-6 text-base font-semibold text-fg transition-colors duration-200 hover:bg-surface-2"
            >
              <Smartphone className="h-5 w-5" aria-hidden="true" />
              Phone → PC
            </Link>
            <Link
              href="/chat"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-edge-strong bg-surface px-6 text-base font-semibold text-fg transition-colors duration-200 hover:bg-surface-2"
            >
              <MessagesSquare className="h-5 w-5" aria-hidden="true" />
              Chat rooms
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

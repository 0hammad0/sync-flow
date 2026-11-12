import { ImageResponse } from 'next/og';

/** Shared 1200×630 social card for opengraph-image and twitter-image. */
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT =
  'SyncFlow — share files privately, straight from your browser. Share files, Phone → PC and Chat rooms.';

const TOOLS = [
  { name: 'Share files', note: 'End-to-end encrypted by default' },
  { name: 'Phone → PC', note: 'Scan a QR code, files land on your PC' },
  { name: 'Chat rooms', note: 'Temporary rooms that delete themselves' },
];

export function renderOgCard() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          background:
            'radial-gradient(900px 500px at 0% 0%, rgba(20,184,166,0.22), transparent 70%), radial-gradient(700px 420px at 100% 100%, rgba(34,225,235,0.12), transparent 70%), #0a0d0c',
          color: '#f1f3f0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <svg width="56" height="56" viewBox="0 0 32 32">
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#0c7d6f" />
                <stop offset="1" stopColor="#00c2cb" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="9" fill="url(#g)" />
            <path d="M7 13.2c3-3.4 6-3.4 9 0s6 3.4 9 0" stroke="white" strokeWidth="2.6" strokeLinecap="round" fill="none" />
            <path d="M7 20.4c3-3.4 6-3.4 9 0s6 3.4 9 0" stroke="white" strokeWidth="2.6" strokeLinecap="round" fill="none" opacity="0.55" />
          </svg>
          <div style={{ fontSize: 36, letterSpacing: -1 }}>SyncFlow</div>
          <div
            style={{
              marginLeft: 'auto',
              fontSize: 22,
              color: '#aab2ac',
              display: 'flex',
            }}
          >
            Free · Open source · MIT
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 76, lineHeight: 1.08, letterSpacing: -3, display: 'flex' }}>
            <span>Share files&nbsp;</span>
            <span style={{ color: '#3ddbc9' }}>privately</span>
            <span>,</span>
          </div>
          <div style={{ fontSize: 76, lineHeight: 1.08, letterSpacing: -3, display: 'flex' }}>
            straight from your browser.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 20 }}>
          {TOOLS.map((t) => (
            <div
              key={t.name}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                padding: '22px 24px',
                borderRadius: 20,
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(17,21,19,0.85)',
              }}
            >
              <div style={{ fontSize: 30, color: '#f1f3f0' }}>{t.name}</div>
              <div style={{ fontSize: 20, color: '#aab2ac', marginTop: 8 }}>{t.note}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    OG_SIZE
  );
}

/**
 * Hand-built SVG scenes for the landing page. Pure markup — the motion lives
 * in landing.css and only runs inside a playing <Scene>. Each scene's static
 * (no-JS / reduced-motion) state is a complete, composed illustration.
 * Captions are real HTML next to the SVG, so nothing here needs to be read.
 */

const svgProps = {
  xmlns: 'http://www.w3.org/2000/svg',
  fill: 'none',
  role: 'img' as const,
};

/** 1. Share files — a file is encrypted at the lock, then becomes a link whose key stays after the #. */
export function ShareScene() {
  return (
    <svg viewBox="0 0 560 300" {...svgProps} aria-labelledby="scene-share-t scene-share-d">
      <title id="scene-share-t">How a file share works</title>
      <desc id="scene-share-d">
        A file leaves your browser, is locked with AES-256-GCM on the way, and turns into a share
        link. The key sits after the # in the link.
      </desc>

      {/* Track + progress trail */}
      <line x1="174" y1="150" x2="392" y2="150" className="line" strokeDasharray="3 7" />
      <line
        x1="174"
        y1="150"
        x2="392"
        y2="150"
        pathLength={1}
        className="anim s-trail accent-stroke"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Browser window with a drop zone */}
      <rect x="24" y="70" width="150" height="160" rx="14" className="panel" />
      <line x1="24" y1="96" x2="174" y2="96" className="line" />
      <circle cx="42" cy="83" r="3.5" className="ink-soft" />
      <circle cx="54" cy="83" r="3.5" className="ink-soft" />
      <circle cx="66" cy="83" r="3.5" className="ink-soft" />
      <rect x="42" y="110" width="114" height="102" rx="10" className="line" strokeDasharray="4 5" />

      {/* Travelling packet — plain file, then ciphertext after the lock */}
      <g className="anim s-packet">
        <g className="anim s-doc">
          <path d="M86 138h16l10 10v22a4 4 0 0 1-4 4H86a4 4 0 0 1-4-4v-28a4 4 0 0 1 4-4z" className="panel" />
          <path d="M102 138v10h10" className="line" />
          <rect x="88" y="154" width="16" height="3" rx="1.5" className="ink-soft" />
          <rect x="88" y="161" width="11" height="3" rx="1.5" className="ink-soft" />
        </g>
        <g className="anim s-cipher">
          <rect x="82" y="138" width="30" height="36" rx="5" className="cipher" />
          <rect x="87" y="146" width="8" height="3" rx="1.5" className="on-accent" opacity="0.9" />
          <rect x="98" y="146" width="9" height="3" rx="1.5" className="on-accent" opacity="0.6" />
          <rect x="87" y="154" width="13" height="3" rx="1.5" className="on-accent" opacity="0.6" />
          <rect x="87" y="162" width="6" height="3" rx="1.5" className="on-accent" opacity="0.9" />
          <rect x="96" y="162" width="11" height="3" rx="1.5" className="on-accent" opacity="0.6" />
        </g>
      </g>

      {/* Lock node (drawn after the packet so the packet passes behind it) */}
      <circle cx="283" cy="150" r="36" className="anim s-ring accent-stroke" strokeWidth="2" opacity="0" />
      <circle cx="283" cy="150" r="46" className="glow" />
      <circle cx="283" cy="150" r="36" className="panel" />
      <path
        d="M275 147v-7a8 8 0 0 1 16 0v7"
        className="anim s-shackle accent-stroke"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <rect x="268" y="146" width="30" height="23" rx="6" className="accent" />
      <circle cx="283" cy="156" r="2.6" className="on-accent" />
      <rect x="282" y="157" width="2" height="5" rx="1" className="on-accent" />

      {/* Share link pill — /s/x7Qp#key */}
      <rect x="392" y="124" width="150" height="52" rx="26" className="panel" />
      <rect
        x="392"
        y="124"
        width="150"
        height="52"
        rx="26"
        className="anim s-link-glow accent-stroke"
        strokeWidth="2"
      />
      <g transform="translate(404 138)" className="accent-stroke" strokeWidth="2" strokeLinecap="round">
        <path d="M9 17H7A5 5 0 0 1 7 7h2" />
        <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </g>
      <text x="433" y="155" fontSize="13" fontFamily="var(--font-geist-mono), monospace" className="ink" opacity="0.72">
        /s/x7Qp
      </text>
      <text x="488" y="155" fontSize="13" fontWeight="700" fontFamily="var(--font-geist-mono), monospace" className="accent">
        #key
      </text>
      <line
        x1="488"
        y1="161"
        x2="522"
        y2="161"
        pathLength={1}
        className="anim s-key accent-stroke"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** QR modules for the laptop screen — finder patterns + a fixed scatter. */
const QR_MODULES: [number, number][] = [
  [354, 88], [362, 96], [354, 104], [346, 112], [362, 112], [370, 120],
  [354, 128], [346, 136], [362, 136], [378, 136], [370, 144], [386, 152],
  [354, 152], [362, 160], [378, 160], [394, 128], [386, 112], [346, 160],
];

function Finder({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x + 2} y={y + 2} width="20" height="20" rx="3" fill="none" stroke="var(--scene-ink)" strokeWidth="4" />
      <rect x={x + 8} y={y + 8} width="8" height="8" rx="1.5" className="ink" />
    </g>
  );
}

const PHONE_TILES = [55, 84, 113];
const ROW_Y = [88, 114, 140];

/** 2. Phone → PC — the phone scans the QR on the PC, then files fly across. */
export function PhoneScene() {
  return (
    <svg viewBox="0 0 560 300" {...svgProps} aria-labelledby="scene-phone-t scene-phone-d">
      <title id="scene-phone-t">How Phone → PC works</title>
      <desc id="scene-phone-d">
        Your phone scans the QR code shown on your PC, then picked files travel from the phone and
        appear in a list on the PC, ready to download one by one or as a ZIP.
      </desc>
      <defs>
        <linearGradient id="beam-grad" x1="150" y1="0" x2="318" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--scene-accent)" stopOpacity="0.38" />
          <stop offset="1" stopColor="var(--scene-accent)" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {/* Laptop */}
      <rect x="290" y="44" width="240" height="166" rx="12" className="panel" />
      <rect x="300" y="54" width="220" height="146" rx="7" className="panel-2" />
      <path d="M268 212h284l-10 16H278z" className="panel" />
      <rect x="392" y="212" width="36" height="4" rx="2" className="ink-soft" />

      {/* QR code */}
      <rect x="318" y="80" width="90" height="90" rx="6" className="panel" />
      <Finder x={322} y={84} />
      <Finder x={380} y={84} />
      <Finder x={322} y={142} />
      {QR_MODULES.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="6" height="6" rx="1" className="ink" />
      ))}
      <rect x="318" y="82" width="90" height="2.5" rx="1.25" className="anim p-scan accent" />

      {/* Received list */}
      {ROW_Y.map((y, i) => (
        <g key={y} className="anim p-row" style={{ '--i': i } as React.CSSProperties}>
          <rect x="420" y={y} width="88" height="20" rx="6" className="panel" />
          <rect x="425" y={y + 4} width="12" height="12" rx="3" className="accent-2" />
          <rect x="443" y={y + 8.5} width={48 - i * 8} height="3" rx="1.5" className="ink-soft" />
        </g>
      ))}
      <g className="anim p-zip">
        <rect x="420" y="166" width="88" height="20" rx="10" className="accent" />
        <path d="M464 170v8m-3.5-3.5L464 178l3.5-3.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* Session window draining */}
      <rect x="318" y="190" width="190" height="3" rx="1.5" className="ink-soft" opacity="0.5" />
      <rect x="318" y="190" width="190" height="3" rx="1.5" className="anim p-session accent" />

      {/* Linked badge */}
      <g className="anim p-check">
        <circle cx="408" cy="80" r="11" className="accent" />
        <path d="m403 80 3.5 3.5L413 77" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* Scan beam */}
      <path d="M150 96 318 80v90L150 112z" fill="url(#beam-grad)" className="anim p-beam" />

      {/* Phone */}
      <rect x="40" y="44" width="110" height="212" rx="22" className="panel" />
      <rect x="48" y="58" width="94" height="186" rx="14" className="panel-2" />
      <rect x="80" y="50" width="30" height="4" rx="2" className="ink-soft" />
      {/* Viewfinder corners */}
      <g className="accent-stroke" strokeWidth="2.5" strokeLinecap="round">
        <path d="M62 84v-8h8M128 84v-8h-8M62 120v8h8M128 120v8h-8" />
      </g>
      <rect x="78" y="92" width="34" height="20" rx="4" fill="var(--scene-line)" />
      {/* Photos to send */}
      {PHONE_TILES.map((x) => (
        <g key={x}>
          <rect x={x} y="150" width="22" height="22" rx="5" className="accent-2" opacity="0.35" />
          <path d={`M${x + 4} ${168}l5-6 4 4 3-3 3 5z`} className="accent-2" />
        </g>
      ))}
      <rect x="60" y="196" width="70" height="26" rx="13" className="accent" />
      <rect x="78" y="207.5" width="34" height="3" rx="1.5" className="on-accent" opacity="0.9" />

      {/* Flying files */}
      {PHONE_TILES.map((x, i) => (
        <rect
          key={`chip-${x}`}
          x={x}
          y="150"
          width="22"
          height="22"
          rx="5"
          className="anim p-chip accent-2"
          style={
            {
              '--i': i,
              '--dx': `${425 - x}px`,
              '--dy': `${ROW_Y[i] + 4 - 150}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </svg>
  );
}

/** 3. Chat rooms — messages, a reaction, an attachment, then the room expires. */
export function ChatScene() {
  return (
    <svg viewBox="0 0 560 300" {...svgProps} aria-labelledby="scene-chat-t scene-chat-d">
      <title id="scene-chat-t">How chat rooms work</title>
      <desc id="scene-chat-d">
        Messages, a reaction and a file attachment appear in a chat room while a clock in the corner
        counts down; when it runs out, the room empties.
      </desc>

      <rect x="80" y="18" width="400" height="266" rx="18" className="panel" />
      <line x1="80" y1="64" x2="480" y2="64" className="line" />

      {/* Header: members + title + expiry clock */}
      <circle cx="108" cy="41" r="10" className="accent" />
      <circle cx="124" cy="41" r="10" className="accent-2" stroke="var(--scene-panel)" strokeWidth="2.5" />
      <rect x="144" y="33" width="92" height="7" rx="3.5" className="ink" opacity="0.8" />
      <rect x="144" y="45" width="58" height="5" rx="2.5" className="ink-soft" />
      <circle cx="452" cy="41" r="10" className="line" strokeWidth="2.5" />
      <circle
        cx="452"
        cy="41"
        r="10"
        pathLength={1}
        className="anim c-clock accent-stroke"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <text x="400" y="45" fontSize="12" fontFamily="var(--font-geist-mono), monospace" className="ink" opacity="0.6">
        24h
      </text>

      {/* Bubble 1 (them) */}
      <g className="anim c-b1 c-left">
        <rect x="100" y="80" width="190" height="44" rx="14" className="panel-2" />
        <rect x="114" y="93" width="150" height="6" rx="3" className="ink-soft" />
        <rect x="114" y="105" width="96" height="6" rx="3" className="ink-soft" />
      </g>

      {/* Bubble 2 (you) + reaction */}
      <g className="anim c-b2 c-right">
        <rect x="270" y="132" width="190" height="44" rx="14" className="accent" />
        <rect x="284" y="145" width="140" height="6" rx="3" className="on-accent" opacity="0.85" />
        <rect x="284" y="157" width="82" height="6" rx="3" className="on-accent" opacity="0.6" />
      </g>
      <g className="anim c-react">
        <circle cx="282" cy="180" r="11" className="panel" />
        <path d="M282 185.5l-4.6-4.4a2.9 2.9 0 0 1 4.6-3.5 2.9 2.9 0 0 1 4.6 3.5z" className="accent" />
      </g>

      {/* Bubble 3 (them) with attachment */}
      <g className="anim c-b3 c-left">
        <rect x="100" y="194" width="214" height="52" rx="14" className="panel-2" />
        <path d="M114 204h18l8 8v20a3 3 0 0 1-3 3h-23a3 3 0 0 1-3-3v-25a3 3 0 0 1 3-3z" className="accent-2" opacity="0.9" />
        <path d="M132 204v8h8" stroke="var(--scene-panel)" strokeWidth="1.5" />
        <rect x="152" y="210" width="112" height="6" rx="3" className="ink-soft" />
        <rect x="152" y="222" width="64" height="6" rx="3" className="ink-soft" />
      </g>

      {/* Typing indicator */}
      <g className="anim c-typing c-left">
        <rect x="100" y="256" width="54" height="20" rx="10" className="panel-2" />
        <circle cx="114" cy="266" r="2.8" className="ink-soft" />
        <circle cx="127" cy="266" r="2.8" className="ink-soft" />
        <circle cx="140" cy="266" r="2.8" className="ink-soft" />
      </g>

      {/* Optional AI action — user-triggered */}
      <rect x="336" y="254" width="124" height="24" rx="12" className="anim c-ai-glow c-right accent-stroke" strokeWidth="2" />
      <g className="anim c-ai c-right">
        <rect x="336" y="254" width="124" height="24" rx="12" className="panel" />
        <path
          d="M352 259.5l1.6 3.9 3.9 1.6-3.9 1.6-1.6 3.9-1.6-3.9-3.9-1.6 3.9-1.6z"
          className="accent"
        />
        <rect x="364" y="263" width="82" height="6" rx="3" className="accent" opacity="0.55" />
      </g>
    </svg>
  );
}

/** 4. Closing band — the logo's two waves stretched across, drawn once. */
export function WaveLines() {
  return (
    <svg
      viewBox="0 0 1200 160"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ height: '100%' }}
    >
      <path
        d="M-10 64C90 18 190 18 290 64s200 46 300 0 200-46 300 0 200 46 310 0"
        pathLength={1}
        className="w-line"
        stroke="var(--scene-accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M-10 104C90 58 190 58 290 104s200 46 300 0 200-46 300 0 200 46 310 0"
        pathLength={1}
        className="w-line w-line-2"
        stroke="var(--scene-accent-2)"
        strokeOpacity="0.55"
        strokeWidth="2.5"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

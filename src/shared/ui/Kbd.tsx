type KbdProps = {
  /** e.g. ['mod', 'K']. `mod` is ⌘ on Apple, Ctrl elsewhere. */
  keys: ('mod' | 'shift' | 'alt' | (string & {}))[];
  className?: string;
  /**
   * Inside a control that is named by `aria-label` and announces the shortcut
   * with `aria-keyshortcuts`: the keys are drawn with CSS `content`, so they
   * are not text in the DOM. A shortcut hint is not part of the control's
   * label, and visible text the name lacks fails WCAG 2.5.3 (axe
   * label-content-name-mismatch), so the hint must not count as label text.
   */
  decorative?: boolean;
};

// [Apple, other]. Both render; CSS shows one from html[data-platform="mac"],
// so server and client output match (no hydration mismatch).
const PLATFORM_KEYS: Record<string, [mac: string, macName: string, other: string]> = {
  mod: ['⌘', 'Command', 'Ctrl'],
  shift: ['⇧', 'Shift', 'Shift'],
  alt: ['⌥', 'Option', 'Alt'],
};

const KEY = 'inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-edge bg-surface-2 px-1 font-mono text-[11px] leading-none text-fg-muted';

/** A key label as text, or (decorative) as CSS-drawn glyphs with no DOM text. */
function Glyph({ text, decorative }: { text: string; decorative: boolean }) {
  return decorative ? <span data-key={text} className="before:content-[attr(data-key)]" /> : <>{text}</>;
}

/** Keyboard shortcut hint. Hidden on touch, where no keyboard is assumed. */
export default function Kbd({ keys, className = '', decorative = false }: KbdProps) {
  return (
    <kbd aria-hidden={decorative || undefined} className={`inline-flex items-center gap-0.5 font-sans pointer-coarse:hidden ${className}`}>
      {keys.map((key) => {
        const platform = PLATFORM_KEYS[key];
        if (!platform) {
          return (
            <kbd key={key} className={KEY}>
              <Glyph text={key} decorative={decorative} />
            </kbd>
          );
        }
        const [mac, macName, other] = platform;
        return (
          <kbd key={key} className={KEY}>
            <span className="hidden in-data-[platform=mac]:inline">
              <span aria-hidden="true">
                <Glyph text={mac} decorative={decorative} />
              </span>
              {!decorative && <span className="sr-only">{macName}</span>}
            </span>
            <span className="in-data-[platform=mac]:hidden">
              <Glyph text={other} decorative={decorative} />
            </span>
          </kbd>
        );
      })}
    </kbd>
  );
}

type KbdProps = {
  /** e.g. ['mod', 'K']. `mod` is ⌘ on Apple, Ctrl elsewhere. */
  keys: ('mod' | 'shift' | 'alt' | (string & {}))[];
  className?: string;
};

// [Apple, other]. Both render; CSS shows one from html[data-platform="mac"],
// so server and client output match (no hydration mismatch).
const PLATFORM_KEYS: Record<string, [mac: string, macName: string, other: string]> = {
  mod: ['⌘', 'Command', 'Ctrl'],
  shift: ['⇧', 'Shift', 'Shift'],
  alt: ['⌥', 'Option', 'Alt'],
};

const KEY = 'inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-edge bg-surface-2 px-1 font-mono text-[11px] leading-none text-fg-muted';

/** Keyboard shortcut hint. Hidden on touch, where no keyboard is assumed. */
export default function Kbd({ keys, className = '' }: KbdProps) {
  return (
    <kbd className={`inline-flex items-center gap-0.5 font-sans pointer-coarse:hidden ${className}`}>
      {keys.map((key) => {
        const platform = PLATFORM_KEYS[key];
        if (!platform) {
          return (
            <kbd key={key} className={KEY}>
              {key}
            </kbd>
          );
        }
        const [mac, macName, other] = platform;
        return (
          <kbd key={key} className={KEY}>
            <span className="hidden in-data-[platform=mac]:inline">
              <span aria-hidden="true">{mac}</span>
              <span className="sr-only">{macName}</span>
            </span>
            <span className="in-data-[platform=mac]:hidden">{other}</span>
          </kbd>
        );
      })}
    </kbd>
  );
}

import { blockedHref, blockedRef, BLOCKED_MESSAGE } from '@/shared/lib/blocked';

/**
 * An action's error text, inline. A blocked action shows the one shared
 * message plus "Why?" → /blocked?ref=…; anything else renders as given.
 * No 'use client' and no hooks: it renders inside the flows' own error lines.
 */
export default function ActionError({ text }: { text: string }) {
  const ref = blockedRef(text);
  if (ref === undefined) return <>{text}</>;
  return (
    <>
      {BLOCKED_MESSAGE}{' '}
      <a href={blockedHref(ref)} className="underline underline-offset-2">
        Why?
      </a>
    </>
  );
}

'use client';

import { useEffect, useRef } from 'react';

/**
 * Plays the SVG animation inside only while it is on screen and the tab is
 * visible, by toggling [data-play] (see landing.css). Off screen, every
 * animation is paused — nothing runs that nobody can see.
 */
export default function Scene({
  children,
  className = '',
  threshold = 0.25,
}: {
  children: React.ReactNode;
  className?: string;
  threshold?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let inView = false;
    const sync = () => {
      if (inView && !document.hidden) el.setAttribute('data-play', '');
      else el.removeAttribute('data-play');
    };
    if (typeof IntersectionObserver === 'undefined') {
      inView = true;
      sync();
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        inView = !!entry?.isIntersecting;
        sync();
      },
      { threshold }
    );
    io.observe(el);
    document.addEventListener('visibilitychange', sync);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [threshold]);

  return (
    <div ref={ref} className={`scene ${className}`}>
      {children}
    </div>
  );
}

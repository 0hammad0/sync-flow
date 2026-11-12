'use client';

import { useEffect, useRef } from 'react';

interface RevealProps {
  children: React.ReactNode;
  /** Stagger delay in ms */
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'span';
}

/**
 * Scroll-reveal wrapper: fades + rises children in the first time they
 * enter the viewport. Pure CSS transition (see .reveal in globals.css) —
 * content is only hidden under `html.js`, so it is fully visible with
 * scripts off, and reduced-motion users get it immediately.
 */
export default function Reveal({
  children,
  delay = 0,
  className = '',
  as: Tag = 'div',
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('is-visible');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          el.classList.add('is-visible');
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as React.Ref<never>}
      className={`reveal ${className}`}
      style={delay ? ({ '--reveal-delay': `${delay}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
}

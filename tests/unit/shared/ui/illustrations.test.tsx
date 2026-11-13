import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AllClear from '@/shared/ui/illustrations/AllClear';
import EmptyFiles from '@/shared/ui/illustrations/EmptyFiles';
import ErrorGeneric from '@/shared/ui/illustrations/ErrorGeneric';
import Forbidden from '@/shared/ui/illustrations/Forbidden';
import MapEmpty from '@/shared/ui/illustrations/MapEmpty';
import NoBlocks from '@/shared/ui/illustrations/NoBlocks';
import NoDataYet from '@/shared/ui/illustrations/NoDataYet';
import NoResults from '@/shared/ui/illustrations/NoResults';
import NotFound from '@/shared/ui/illustrations/NotFound';
import Offline from '@/shared/ui/illustrations/Offline';

// The set in docs/admin/02-design/07-motion-and-illustrations.md ("The set").
const SET = {
  NoDataYet,
  NoResults,
  ErrorGeneric,
  Offline,
  Forbidden,
  NotFound,
  EmptyFiles,
  NoBlocks,
  MapEmpty,
  AllClear,
};

describe('illustrations', () => {
  it.each(Object.entries(SET))('%s is a decorative 160×120 svg themed by tokens', (_, Component) => {
    const { container } = render(<Component />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 160 120');
    expect(svg?.getAttribute('class')).toContain('text-fg-faint');
    // Colours only from tokens: no hard-coded hex or rgb anywhere in the markup.
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it('NoDataYet breathes only while waiting', () => {
    const idle = render(<NoDataYet />);
    expect(idle.container.querySelector('.sf-breathe')).toBeNull();
    idle.unmount();
    const waiting = render(<NoDataYet waiting />);
    expect(waiting.container.querySelector('.sf-breathe')).not.toBeNull();
  });

  it('ships its CSS once, with a reduced-motion override', () => {
    render(
      <>
        <NoResults />
        <AllClear />
      </>
    );
    const styles = document.head.querySelectorAll('style[data-href="sf-illustration"]');
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toContain('prefers-reduced-motion:reduce');
  });
});

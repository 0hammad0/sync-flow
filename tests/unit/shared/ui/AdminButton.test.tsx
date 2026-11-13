import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Plus } from 'lucide-react';
import AdminButton from '@/shared/ui/AdminButton';
import IconButton from '@/shared/ui/IconButton';
import { buttonClass, iconButtonClass, type ButtonVariant } from '@/shared/ui/button-styles';

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'danger-solid', 'link'];

// Base utilities (no `hover:` etc.) that set a colour. Two for one property clash,
// and CSS chunk order then decides the winner (the unreadable "New block" bug).
const NOT_COLOUR = /^(text-(xs|sm|base|lg|center|left|right|balance|\[\d+px\])|border(-[0-9])?$|bg-(clip|none))/;
function baseColours(classes: string, prefix: 'bg-' | 'text-' | 'border-') {
  return classes
    .split(/\s+/)
    .filter((c) => !c.includes(':') && c.startsWith(prefix) && !NOT_COLOUR.test(c));
}

describe('button styles', () => {
  it.each(VARIANTS)('%s sets at most one background, text and border colour', (variant) => {
    for (const size of ['sm', 'md'] as const) {
      const classes = buttonClass({ variant, size });
      expect(baseColours(classes, 'bg-').length).toBeLessThanOrEqual(1);
      expect(baseColours(classes, 'text-')).toHaveLength(1);
      expect(baseColours(classes, 'border-').length).toBeLessThanOrEqual(1);
    }
  });

  it('primary uses the on-brand text token, readable in both themes', () => {
    expect(buttonClass({ variant: 'primary' })).toContain('bg-brand text-on-brand');
  });

  it('appends layout classes last', () => {
    expect(buttonClass({ className: 'md:hidden' }).endsWith(' md:hidden')).toBe(true);
    expect(iconButtonClass('-mr-1').endsWith(' -mr-1')).toBe(true);
  });
});

describe('AdminButton', () => {
  it('renders an icon and the label', () => {
    const { container } = render(<AdminButton icon={Plus}>New block</AdminButton>);
    expect(screen.getByRole('button', { name: 'New block' })).toBeTruthy();
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });

  it('loading: busy, ignores clicks, keeps focus (aria-disabled, not disabled)', () => {
    const onClick = vi.fn();
    render(
      <AdminButton loading onClick={onClick}>
        Save
      </AdminButton>
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loadingText replaces the label while busy', () => {
    render(
      <AdminButton loading loadingText="Sending…">
        Send link
      </AdminButton>
    );
    expect(screen.getByRole('button').textContent).toBe('Sending…');
  });

  it('href renders a link with the same look', () => {
    render(
      <AdminButton href="/admin" variant="primary">
        Back
      </AdminButton>
    );
    const link = screen.getByRole('link', { name: 'Back' });
    expect(link.className).toContain('bg-brand');
  });
});

describe('IconButton', () => {
  it('needs a label and renders one icon', () => {
    const onClick = vi.fn();
    render(<IconButton icon={Plus} aria-label="Add" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

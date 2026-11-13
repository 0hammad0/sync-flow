import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Input from '@/shared/ui/Input';

describe('Input', () => {
  it('links the label and the hint', () => {
    render(<Input label="Room name" hint="Up to 40 characters." />);
    const field = screen.getByRole('textbox', { name: 'Room name' });
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(document.getElementById(field.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Up to 40 characters.');
  });

  it('marks the field invalid and replaces the hint with the error', () => {
    render(<Input label="Room name" hint="Up to 40 characters." error="Use 40 characters or fewer." />);
    const field = screen.getByRole('textbox', { name: 'Room name' });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(field.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Use 40 characters or fewer.'
    );
    expect(screen.queryByText('Up to 40 characters.')).toBeNull();
  });

  it('keeps a hidden label for screen readers', () => {
    render(<Input label="Search sessions" hideLabel type="search" />);
    expect(screen.getByRole('searchbox', { name: 'Search sessions' })).toBeTruthy();
    expect(screen.getByText('Search sessions').className).toContain('sr-only');
  });
});

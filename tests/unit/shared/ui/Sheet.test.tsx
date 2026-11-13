import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import Sheet from '@/shared/ui/Sheet';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Menu
      </button>
      <Sheet open={open} onOpenChange={setOpen} side="left" title="Navigation" hideTitle>
        <a href="#overview">Overview</a>
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  it('keeps a hidden title as its name, closes on Esc and returns focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Menu' });
    await user.click(trigger);

    const sheet = screen.getByRole('dialog', { name: 'Navigation' });
    expect(sheet.getAttribute('data-side')).toBe('left');
    expect(sheet.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

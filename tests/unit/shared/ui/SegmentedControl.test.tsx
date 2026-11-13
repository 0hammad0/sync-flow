import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import SegmentedControl from '@/shared/ui/SegmentedControl';

type Density = 'compact' | 'default' | 'comfortable';

function Harness() {
  const [value, setValue] = useState<Density>('default');
  return (
    <>
      <button type="button">Before</button>
      <SegmentedControl<Density>
        label="Row density"
        value={value}
        onValueChange={setValue}
        items={[
          { value: 'compact', label: 'Compact' },
          { value: 'default', label: 'Default' },
          { value: 'comfortable', label: 'Comfortable' },
        ]}
      />
      <button type="button">After</button>
    </>
  );
}

const checked = () => screen.getAllByRole('radio').find((r) => r.getAttribute('aria-checked') === 'true');

describe('SegmentedControl', () => {
  it('is a named radio group', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Row density' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(checked()?.textContent).toBe('Default');
  });

  it('takes one Tab stop, landing on the selected item', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('button', { name: 'Before' }).focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Default' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }));
  });

  it('moves and selects with the arrow keys, and never ends up empty', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('button', { name: 'Before' }).focus();
    await user.tab();

    // Radix moves focus in a timeout and selects only while an arrow key is
    // down, so hold each key as a real keyboard does.
    const press = async (key: string) => {
      await user.keyboard(`{${key}>}`);
      await waitFor(() => expect(document.activeElement?.getAttribute('aria-checked')).toBe('true'));
      await user.keyboard(`{/${key}}`);
    };

    await press('ArrowRight');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Comfortable' }));
    expect(checked()?.textContent).toBe('Comfortable');

    await press('ArrowLeft');
    await press('ArrowLeft');
    expect(checked()?.textContent).toBe('Compact');

    await user.keyboard(' '); // Space on the selected item does not clear it
    expect(checked()?.textContent).toBe('Compact');
  });
});

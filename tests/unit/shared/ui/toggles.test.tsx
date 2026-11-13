import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Checkbox from '@/shared/ui/Checkbox';
import Switch from '@/shared/ui/Switch';

function SwitchHarness({ pending = false, onChange = () => {} }: { pending?: boolean; onChange?: (v: boolean) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <Switch
      label="Tracking"
      description="Collect anonymous page views."
      checked={checked}
      pending={pending}
      onCheckedChange={(v) => {
        onChange(v);
        setChecked(v);
      }}
    />
  );
}

describe('Switch', () => {
  it('is a labelled switch that toggles on click, Space, and a label click', async () => {
    const user = userEvent.setup();
    render(<SwitchHarness />);
    const toggle = screen.getByRole('switch', { name: 'Tracking' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(document.getElementById(toggle.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Collect anonymous page views.'
    );

    await user.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    await user.keyboard(' ');
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await user.click(screen.getByText('Tracking'));
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('ignores toggles while a save is pending but keeps focus', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SwitchHarness pending onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Tracking' });
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    expect(toggle.hasAttribute('disabled')).toBe(false);

    await user.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });
});

function CheckboxHarness({ initial }: { initial: boolean | 'indeterminate' }) {
  const [checked, setChecked] = useState(initial);
  return <Checkbox label="Select all" checked={checked} onCheckedChange={setChecked} />;
}

describe('Checkbox', () => {
  it('toggles on click, Space and label click', async () => {
    const user = userEvent.setup();
    render(<CheckboxHarness initial={false} />);
    const box = screen.getByRole('checkbox', { name: 'Select all' });
    expect(box.getAttribute('aria-checked')).toBe('false');

    await user.click(box);
    expect(box.getAttribute('aria-checked')).toBe('true');

    await user.keyboard(' ');
    expect(box.getAttribute('aria-checked')).toBe('false');

    await user.click(screen.getByText('Select all'));
    expect(box.getAttribute('aria-checked')).toBe('true');
  });

  it('reports indeterminate as mixed and becomes checked on click', async () => {
    const user = userEvent.setup();
    render(<CheckboxHarness initial="indeterminate" />);
    const box = screen.getByRole('checkbox', { name: 'Select all' });
    expect(box.getAttribute('aria-checked')).toBe('mixed');
    await user.click(box);
    expect(box.getAttribute('aria-checked')).toBe('true');
  });

  it('takes an aria-label when there is no visible label', () => {
    render(<Checkbox aria-label="Select row 3" checked={false} onCheckedChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Select row 3' })).toBeTruthy();
  });
});

import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ConfirmDialog, { type ConfirmResult } from '@/shared/ui/ConfirmDialog';

type HarnessProps = {
  onConfirm: () => Promise<ConfirmResult>;
  tone?: 'default' | 'danger';
  typeToConfirm?: string;
};

function Harness({ onConfirm, tone, typeToConfirm }: HarnessProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Block IP
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Block 203.0.113.7?"
        consequence="Within 60 s, visitors from this IP can't upload, send or download. Unblock later."
        confirmLabel="Block"
        tone={tone}
        typeToConfirm={typeToConfirm}
        onConfirm={onConfirm}
      />
    </>
  );
}

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  const trigger = screen.getByRole('button', { name: 'Block IP' });
  await user.click(trigger);
  return trigger;
};

describe('ConfirmDialog', () => {
  it('is an alertdialog named by its title and described by the consequence', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={async () => ({ ok: true })} />);
    await open(user);
    const dialog = screen.getByRole('alertdialog', { name: 'Block 203.0.113.7?' });
    const describedBy = dialog.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toMatch(/can't upload/);
  });

  it('focuses Confirm by default and Cancel when the tone is danger', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness onConfirm={async () => ({ ok: true })} />);
    await open(user);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Block' }));
    unmount();

    render(<Harness tone="danger" onConfirm={async () => ({ ok: true })} />);
    await open(user);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('closes on Esc and on Cancel, returning focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={async () => ({ ok: true })} />);
    const trigger = await open(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await open(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('runs the action, ignores Esc while it runs, then closes on success', async () => {
    const user = userEvent.setup();
    let finish: (r: ConfirmResult) => void = () => {};
    const onConfirm = vi.fn(() => new Promise<ConfirmResult>((resolve) => (finish = resolve)));
    render(<Harness onConfirm={onConfirm} />);
    const trigger = await open(user);

    const confirm = screen.getByRole('button', { name: 'Block' });
    await user.click(confirm);
    expect(confirm.getAttribute('aria-busy')).toBe('true');

    await user.click(confirm); // double submit is ignored
    await user.keyboard('{Escape}'); // Esc is ignored while busy
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    finish({ ok: true });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('stays open and shows the reason when the action fails', async () => {
    const user = userEvent.setup();
    render(
      <Harness onConfirm={async () => ({ ok: false, error: 'conflict', message: "It's already blocked." })} />
    );
    await open(user);
    await user.click(screen.getByRole('button', { name: 'Block' }));
    expect((await screen.findByRole('alert')).textContent).toBe("It's already blocked.");
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('enables Confirm only after the exact text is typed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async (): Promise<ConfirmResult> => ({ ok: true }));
    render(<Harness tone="danger" typeToConfirm="203.0.113.7" onConfirm={onConfirm} />);
    await open(user);

    const field = screen.getByRole('textbox', { name: /to confirm/ });
    expect(document.activeElement).toBe(field);
    const confirm = screen.getByRole('button', { name: 'Block' });
    expect(confirm.getAttribute('aria-disabled')).toBe('true');

    await user.type(field, '203.0.113.');
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.type(field, '7');
    expect(confirm.getAttribute('aria-disabled')).toBeNull();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

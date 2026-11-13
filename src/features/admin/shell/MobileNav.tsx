'use client';

import { useState, type MouseEvent, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import Sheet from '@/shared/ui/Sheet';
import IconButton from '@/shared/ui/IconButton';

/** Under 768 px: ☰ in the top bar opens the nav as a left Sheet (focus trapped, Esc closes). */
export default function MobileNav({ nav, footer }: { nav: ReactNode; footer: ReactNode }) {
  const [open, setOpen] = useState(false);

  // Following a link closes the drawer; the new page loads behind it.
  const onClick = (event: MouseEvent) => {
    if ((event.target as Element).closest('a[href]')) setOpen(false);
  };

  return (
    <>
      <IconButton
        icon={Menu}
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="-ml-2 md:hidden"
      />
      <Sheet open={open} onOpenChange={setOpen} side="left" title="Navigation" hideTitle className="md:hidden">
        <div onClick={onClick} className="-mx-4 -mt-4 flex min-h-full flex-col">
          <div className="flex-1">{nav}</div>
          <div className="flex flex-col gap-0.5 border-t border-edge px-2 py-2">{footer}</div>
        </div>
      </Sheet>
    </>
  );
}

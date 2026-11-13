'use client';

import type { ReactElement } from 'react';
import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import type { LucideIcon } from 'lucide-react';
import Kbd from '@/shared/ui/Kbd';

export type MenuItem =
  | {
      type: 'item';
      label: string;
      icon?: LucideIcon;
      onSelect: () => void;
      /** Danger items go last, after a separator. */
      tone?: 'default' | 'danger';
      disabled?: boolean;
      shortcut?: string[];
    }
  | { type: 'separator'; id: string }
  | { type: 'label'; label: string };

type DropdownMenuProps = {
  /** A button. Radix wires aria-haspopup/expanded and Enter/Space/↓ to open. */
  trigger: ReactElement;
  items: MenuItem[];
  align?: 'start' | 'end';
  className?: string;
};

const ITEM =
  'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm select-none pointer-coarse:h-11 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 focus-visible:-outline-offset-2!';

export default function DropdownMenu({ trigger, items, align = 'start', className = '' }: DropdownMenuProps) {
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger asChild>{trigger}</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content
          align={align}
          sideOffset={4}
          collisionPadding={16}
          className={`ui-pop z-50 min-w-[180px] rounded-lg border border-edge bg-surface p-1 text-fg shadow-[var(--shadow-float)] ${className}`}
        >
          {items.map((item) => {
            if (item.type === 'separator') {
              return <MenuPrimitive.Separator key={item.id} className="-mx-1 my-1 h-px bg-edge" />;
            }
            if (item.type === 'label') {
              return (
                <MenuPrimitive.Label key={`label:${item.label}`} className="px-2 pt-1.5 pb-1 text-xs text-fg-muted">
                  {item.label}
                </MenuPrimitive.Label>
              );
            }
            const Icon = item.icon;
            const danger = item.tone === 'danger';
            return (
              <MenuPrimitive.Item
                key={`item:${item.label}`}
                disabled={item.disabled}
                onSelect={item.onSelect}
                className={`${ITEM} ${danger ? 'text-danger-text' : ''}`}
              >
                {Icon && (
                  <Icon
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className={`size-4 shrink-0 ${danger ? 'text-danger-text' : 'text-fg-muted'}`}
                  />
                )}
                <span className="flex-1 truncate">{item.label}</span>
                {item.shortcut && <Kbd keys={item.shortcut} className="ml-4" />}
              </MenuPrimitive.Item>
            );
          })}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

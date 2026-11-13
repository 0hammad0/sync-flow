'use client';

import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import { Check, Columns3, Rows2, Rows3, Rows4, type LucideIcon } from 'lucide-react';
import type { Density } from './types';
import IconButton from '@/shared/ui/IconButton';

export type ColumnMenuItem = { id: string; label: string; visible: boolean; /** P1 columns cannot be hidden. */ locked: boolean };

type ColumnMenuProps = {
  columns: ColumnMenuItem[];
  onToggle: (id: string, visible: boolean) => void;
  density: Density;
  onDensityChange: (density: Density) => void;
};

const DENSITY_ITEMS: { value: Density; label: string; icon: LucideIcon }[] = [
  { value: 'compact', label: 'Compact', icon: Rows4 },
  { value: 'default', label: 'Default', icon: Rows3 },
  { value: 'comfortable', label: 'Comfortable', icon: Rows2 },
];

// Same look as the kit's DropdownMenu items.
const ITEM =
  'relative flex h-8 cursor-pointer items-center gap-2 rounded-md pr-2 pl-7 text-sm select-none pointer-coarse:h-11 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 focus-visible:-outline-offset-2!';
const INDICATOR = 'absolute left-2 inline-flex size-4 items-center justify-center';
const LABEL = 'px-2 pt-1.5 pb-1 text-xs text-fg-muted';

/**
 * "Columns" menu: show/hide columns (state in `?cols=`) and row density.
 * Hidden under a 640 px container, where the table becomes cards.
 */
export default function ColumnMenu({ columns, onToggle, density, onDensityChange }: ColumnMenuProps) {
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger asChild>
        <IconButton icon={Columns3} aria-label="Columns" />
      </MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content
          align="end"
          sideOffset={4}
          collisionPadding={16}
          className="ui-pop z-50 min-w-[200px] rounded-lg border border-edge bg-surface p-1 text-fg shadow-[var(--shadow-float)]"
        >
          <MenuPrimitive.Label className={LABEL}>Columns</MenuPrimitive.Label>
          {columns.map((column) => (
            <MenuPrimitive.CheckboxItem
              key={column.id}
              checked={column.visible}
              disabled={column.locked}
              // Keep the menu open to toggle several columns in a row.
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) => onToggle(column.id, checked === true)}
              className={ITEM}
            >
              <MenuPrimitive.ItemIndicator className={INDICATOR}>
                <Check aria-hidden="true" strokeWidth={2} className="size-3.5" />
              </MenuPrimitive.ItemIndicator>
              {column.label}
            </MenuPrimitive.CheckboxItem>
          ))}
          <MenuPrimitive.Separator className="-mx-1 my-1 h-px bg-edge" />
          <MenuPrimitive.Label className={LABEL}>Density</MenuPrimitive.Label>
          <MenuPrimitive.RadioGroup value={density} onValueChange={(value) => onDensityChange(value as Density)}>
            {DENSITY_ITEMS.map(({ value, label, icon: Icon }) => (
              <MenuPrimitive.RadioItem key={value} value={value} className={ITEM}>
                <MenuPrimitive.ItemIndicator className={INDICATOR}>
                  <Check aria-hidden="true" strokeWidth={2} className="size-3.5" />
                </MenuPrimitive.ItemIndicator>
                <Icon aria-hidden="true" strokeWidth={1.75} className="size-4 text-fg-muted" />
                {label}
              </MenuPrimitive.RadioItem>
            ))}
          </MenuPrimitive.RadioGroup>
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

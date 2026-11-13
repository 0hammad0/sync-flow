import SidebarItem from './SidebarItem';
import type { NavGroup } from './nav';

type SidebarNavProps = {
  /** Already filtered for the role (filterNav). */
  groups: NavGroup[];
  /** Rendered in the sidebar and in the mobile drawer: ids must not collide. */
  idPrefix: string;
};

/**
 * Grouped admin navigation. Group labels show in the open sidebar; in the
 * rail the same 28 px row shows a divider instead, so icons never move.
 */
export default function SidebarNav({ groups, idPrefix }: SidebarNavProps) {
  return (
    <nav aria-label="Admin" className="py-2">
      {groups.map((group) => {
        const labelId = group.label ? `${idPrefix}-nav-${group.id}` : undefined;
        return (
          <div key={group.id} className="px-2">
            {group.label && (
              <div className="relative mt-2 flex h-7 items-center">
                <span aria-hidden="true" className="admin-sb-divider absolute top-1/2 left-2 h-px w-8 bg-edge" />
                <span id={labelId} className="admin-sb-label label-mono truncate pl-4">
                  {group.label}
                </span>
              </div>
            )}
            <ul aria-labelledby={labelId} className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <SidebarItem key={item.href} item={item} />
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

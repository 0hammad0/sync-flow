import {
  Activity,
  FileText,
  Globe,
  HardDrive,
  LayoutDashboard,
  Link2,
  MessagesSquare,
  MousePointerClick,
  Radio,
  ScrollText,
  Settings,
  ShieldBan,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import NavLink from './NavLink';
import { SIDEBAR_ROW } from './styles';
import type { NavIcon, NavItem } from './nav';

// Server Component: icons render to SVG on the server and never ship as JS.
const ICONS: Record<NavIcon, LucideIcon> = {
  overview: LayoutDashboard,
  live: Radio,
  sessions: Users,
  pages: FileText,
  clicks: MousePointerClick,
  geography: Globe,
  sources: Link2,
  files: HardDrive,
  rooms: MessagesSquare,
  users: UserRound,
  access: ShieldBan,
  audit: ScrollText,
  health: Activity,
  settings: Settings,
};

const ACTIVE =
  'aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium aria-[current=page]:text-fg before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-brand before:opacity-0 aria-[current=page]:before:opacity-100';

export default function SidebarItem({ item }: { item: NavItem }) {
  const Icon = ICONS[item.icon];
  return (
    <li>
      <NavLink href={item.href} className={`${SIDEBAR_ROW} ${ACTIVE}`}>
        <Icon aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
        <span className="admin-sb-label truncate">{item.label}</span>
      </NavLink>
    </li>
  );
}

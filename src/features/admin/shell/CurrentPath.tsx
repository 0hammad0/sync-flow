'use client';

import { usePathname } from 'next/navigation';

/** The current URL path, for "There's no admin page at /admin/xyz". */
export default function CurrentPath() {
  return <span className="font-mono text-xs break-all">{usePathname()}</span>;
}

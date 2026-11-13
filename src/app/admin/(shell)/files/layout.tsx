import type { ReactNode } from 'react';

// `drawer`: the file detail drawer (intercepted `/admin/files/[fileId]` on a
// soft navigation). A direct load renders the full page in `children`.
export default function FilesLayout({ children, drawer }: { children: ReactNode; drawer: ReactNode }) {
  return (
    <>
      {children}
      {drawer}
    </>
  );
}

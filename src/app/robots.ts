import type { MetadataRoute } from 'next';
import { siteUrl } from '@/shared/lib/site';

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Private, per-user or per-session pages: never index.
        // `/chat/` (with the trailing slash) blocks room pages but not the /chat lobby.
        disallow: ['/share/', '/send/', '/chat/', '/dashboard', '/login', '/auth/', '/api/'],
      },
    ],
    sitemap: new URL('/sitemap.xml', base).toString(),
    host: base.origin,
  };
}

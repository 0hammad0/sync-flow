import type { MetadataRoute } from 'next';
import { siteUrl } from '@/shared/lib/site';

const ROUTES: { path: string; priority: number; changeFrequency: 'weekly' | 'monthly' | 'yearly' }[] = [
  { path: '/', priority: 1, changeFrequency: 'weekly' },
  { path: '/receive', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/chat', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/terms', priority: 0.3, changeFrequency: 'yearly' },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: new URL(path, base).toString(),
    changeFrequency,
    priority,
  }));
}

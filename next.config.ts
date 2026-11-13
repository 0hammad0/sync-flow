import type { NextConfig } from "next";

// Admin pages and admin API: never indexed, never cached, never framed.
// Spec: docs/admin/01-architecture/04-auth-and-security.md ("Headers for /admin").
const ADMIN_HEADERS = [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'Cache-Control', value: 'private, no-store' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  // Hide the floating dev-tools badge — it overlaps the chat composer's
  // bottom-left buttons on mobile viewports.
  devIndicators: false,
  async headers() {
    return [
      // `/admin/:path*` also matches `/admin` itself.
      { source: '/admin/:path*', headers: ADMIN_HEADERS },
      { source: '/api/admin/:path*', headers: ADMIN_HEADERS },
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
    // The proxy (middleware) buffers request bodies with a 10MB default,
    // which silently truncated large uploads before they reached the API
    // routes. Must match the app's 100MB upload cap.
    proxyClientMaxBodySize: '100mb',
  },
};

export default nextConfig;

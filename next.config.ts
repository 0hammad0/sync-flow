import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

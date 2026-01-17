import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  // Optimize CSS loading
  optimizePackageImports: ['lucide-react'],
};

export default nextConfig;

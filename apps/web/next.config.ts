import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  reactStrictMode: true,
  // There is a stray package-lock.json in the Windows home directory. Without
  // this, Next infers that as the workspace root and warns on every start.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // Story pages must render on the server to be crawlable - that is the whole
  // organic-growth bet. Keep an eye on anything that forces a page to 'use client'.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL ?? 'http://localhost:4000'}/api/:path*`,
      },
    ];
  },
};

export default config;

import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  reactStrictMode: true,
  // `next build` also writes a self-contained server (.next/standalone) with
  // only the node_modules it imports - what the production image runs.
  output: 'standalone',
  // There is a stray package-lock.json in the Windows home directory. Without
  // this, Next infers that as the workspace root and warns on every start.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // Story pages must render on the server to be crawlable - that is the whole
  // organic-growth bet. Keep an eye on anything that forces a page to 'use client'.
  /**
   * Keep webpack's cache in memory during development.
   *
   * The default filesystem cache serialises the whole module graph into pack
   * files, and that allocation is what fails on this machine once the editor
   * (TipTap, ProseMirror, Yjs) joins the graph: `RangeError: Array buffer
   * allocation failed`, taking the dev server with it. The cache only makes a
   * restart faster; an in-memory one costs a slower cold start and nothing
   * else. Production builds are untouched.
   */
  webpack(config, { dev }) {
    if (dev) config.cache = { type: 'memory' };
    return config;
  },

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

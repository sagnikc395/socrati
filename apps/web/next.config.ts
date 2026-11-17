import type { NextConfig } from 'next';
import { loadEnvFiles } from './lib/load-env';

// Next only reads .env files next to the app (apps/web), but the project keeps
// one root .env for both the web app and the worker. Loading it here makes
// `next build` / `next start` see the same values as `npm run dev`. Real
// environment variables (Vercel, CI, Docker) win — loadEnvFiles never
// overwrites a value that is already set.
loadEnvFiles();

const nextConfig: NextConfig = {};

export default nextConfig;

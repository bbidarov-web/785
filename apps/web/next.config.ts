import type { NextConfig } from 'next';

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone', // для лёгкого Docker-образа (apps/web/Dockerfile)
  async rewrites() {
    // dev-прокси на API, чтобы cookie сессии работала как same-site без CORS-плясок;
    // в проде nginx/Caddy делает то же самое перед контейнерами (infra/Caddyfile)
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;

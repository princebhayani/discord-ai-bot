/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@hrbot/shared'],
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: '/ai-settings',
        destination: '/',
        permanent: false,
      },
      {
        source: '/categories',
        destination: '/',
        permanent: false,
      },
      {
        source: '/player-integration',
        destination: '/',
        permanent: false,
      },
      {
        source: '/questions',
        destination: '/',
        permanent: false,
      },
      {
        source: '/reports',
        destination: '/',
        permanent: false,
      },
      {
        source: '/server-info',
        destination: '/',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

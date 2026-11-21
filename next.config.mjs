/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  experimental: {
    // DB Management inserts / edits documents through server actions
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;

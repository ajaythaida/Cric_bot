/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next-match-updates",
  reactStrictMode: true
};

export default nextConfig;

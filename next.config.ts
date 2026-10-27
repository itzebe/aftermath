import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@mysten-incubation/memwal"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;

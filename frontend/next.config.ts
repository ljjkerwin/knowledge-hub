import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  devIndicators: false,

  compiler: {
    removeConsole: {
      exclude: ['error'],
    },
  },
};

export default nextConfig;

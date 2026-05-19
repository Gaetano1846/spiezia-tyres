import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.tyre-shopping.com" },
      { protocol: "https", hostname: "**.tyresbay.net" },
      { protocol: "https", hostname: "**.tyres.net" },
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "storage.googleapis.com" },
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Listing photos come from arbitrary host-provided URLs, so we use plain <img>
  // (with a fallback) instead of next/image's allow-listed remote patterns.
  images: { unoptimized: true },
};

export default nextConfig;

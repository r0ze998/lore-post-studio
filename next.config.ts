import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 個人用ローカルツール。外部公開は想定しない（README 参照）。
  poweredByHeader: false,
  serverExternalPackages: ["twitter-text"],
};

export default nextConfig;

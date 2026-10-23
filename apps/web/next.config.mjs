/** @type {import('next').NextConfig} */
const nextConfig = {
  // The engine package ships TypeScript source, so Next compiles it.
  transpilePackages: ["@fantasy-labs/engine"],
};

export default nextConfig;

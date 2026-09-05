import type { NextConfig } from "next";
import { isIP } from "node:net";

const nextConfig: NextConfig = {
  ...(process.env.INFERPOOL_STATIC_EXPORT === "true"
    ? { output: "export" as const, trailingSlash: true }
    : {}),
};

if (process.env.INFERPOOL_PUBLIC_BUILD === "true") {
  const router = new URL(process.env.NEXT_PUBLIC_ROUTER_URL || "http://127.0.0.1:8788");
  const host = router.hostname.toLowerCase().replace(/\.$/, "");
  const ipLiteral = isIP(host.replace(/^\[|\]$/g, "")) !== 0;
  const localName = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || !host.includes(".");
  if (router.protocol !== "https:" || router.username || router.password || router.pathname !== "/" || router.search || router.hash || ipLiteral || localName) {
    throw new Error("Public builds require NEXT_PUBLIC_ROUTER_URL to be an HTTPS DNS origin without credentials, local names, IP literals or a path.");
  }
  if (!process.env.NEXT_PUBLIC_PARA_API_KEY) {
    throw new Error("Public builds require the Para frontend API key.");
  }
}

export default nextConfig;

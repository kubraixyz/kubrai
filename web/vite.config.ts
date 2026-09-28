import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { resolve } from "path";
// A devnet/mainnet bundle built without VITE_API_BASE calls /evidence, /positions… on the page's own
// origin, where Caddy answers with index.html: every API panel silently shows "no data" (2026-09-28).
if (process.argv.includes("build") && (process.env.VITE_CLUSTER ?? "devnet") !== "localnet" && !process.env.VITE_API_BASE)
  throw new Error("VITE_API_BASE is required for a devnet/mainnet build (e.g. VITE_API_BASE=https://api-devnet.kubrai.xyz)");
export default defineConfig({
  plugins: [nodePolyfills({ include: ["buffer", "process", "stream", "util"], globals: { Buffer: true, process: true } })],
  build: { target: "es2020", rollupOptions: { input: { main: resolve(__dirname, "index.html"), market: resolve(__dirname, "market.html"), portfolio: resolve(__dirname, "portfolio.html"), leaderboard: resolve(__dirname, "leaderboard.html"), invite: resolve(__dirname, "invite.html"), docs: resolve(__dirname, "docs.html") } } },
  define: { "process.env.ANCHOR_BROWSER": true },
});
